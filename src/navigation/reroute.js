import CustomEvent from "custom-event";
import { isStarted } from "../start.js";
import { toLoadPromise } from "../lifecycles/load.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  getAppStatus,
  getAppChanges,
  getMountedApps,
} from "../applications/apps.js";
import {
  callCapturedEventListeners,
  navigateToUrl,
} from "./navigation-events.js";
import { toUnloadPromise } from "../lifecycles/unload.js";
import {
  toName,
  shouldBeActive,
  NOT_MOUNTED,
  MOUNTED,
  NOT_LOADED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { assign } from "../utils/assign.js";
import { isInBrowser } from "../utils/runtime-environment.js";

let appChangeUnderway = false, // 应用变更进行中
  peopleWaitingOnAppChange = [], // 等待变更的应用
  currentUrl = isInBrowser && window.location.href;

export function triggerAppChange() {
  return reroute();
}

/**
 * 挂载、卸载应用
 * 1、手动调用：微应用注册和调用start方法的时触发
 * 2、自动触发：在 navigation-events 中监听路由事件发生变化时触发
 * @param {*} pendingPromises
 * @param {*} eventArguments
 */
export function reroute(pendingPromises = [], eventArguments) {
  // 有应用正在切换中、处理中
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  // 不同状态下的 app
  const {
    appsToUnload, // 需要被移除的
    appsToUnmount, // 需要被卸载的
    appsToLoad, // 需要被加载的
    appsToMount, // 需要被挂载的
  } = getAppChanges();

  let appsThatChanged, // 路由改变、正在被处理的应用
    navigationIsCanceled = false, // 取消导航
    oldUrl = currentUrl,
    newUrl = (currentUrl = window.location.href);

  // 是否调用过 start 方法
  if (isStarted()) {
    appChangeUnderway = true;

    // 所有需要被改变的的应用
    appsThatChanged = appsToUnload.concat(
      appsToLoad,
      appsToUnmount,
      appsToMount
    );

    // 切换路由时操作
    return performAppChanges();
  } else {
    // 首次加载应用
    appsThatChanged = appsToLoad;

    // 初始化操纵
    return loadApps();
  }

  // 取消导航
  function cancelNavigation() {
    navigationIsCanceled = true;
  }

  // 1、执行 toLoadPromise 加载应用
  // 2、执行被延迟执行的监听事件
  function loadApps() {
    return Promise.resolve().then(() => {
      // 加载指定应用、挂载生命周期函数、返回 Promise 对象
      const loadPromises = appsToLoad.map(toLoadPromise);

      return (
        // 保证所有子应用加载完成
        Promise.all(loadPromises)
          // 调用所有被延迟执行的监听事件
          .then(callAllEventListeners)
          // 在调用start()之前，没有挂载的应用程序，所以我们总是返回[]
          .then(() => [])
          .catch((err) => {
            callAllEventListeners();
            throw err;
          })
      );
    });
  }

  // 切换路由时执行的方法
  function performAppChanges() {
    return Promise.resolve().then(() => {
      // 执行 'single-spa:before-no-app-change' 或 'single-spa:before-app-change'
      window.dispatchEvent(
        new CustomEvent(
          appsThatChanged.length === 0
            ? "single-spa:before-no-app-change"
            : "single-spa:before-app-change",
          getCustomEventDetail(true)
        )
      );

      // 执行 'single-spa:before-routing-event'
      window.dispatchEvent(
        new CustomEvent(
          "single-spa:before-routing-event",
          getCustomEventDetail(true, { cancelNavigation })
        )
      );

      // 取消导航：执行 'single-spa:before-mount-routing-event'
      if (navigationIsCanceled) {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );

        // 执行当前被 Active 的app
        finishUpAndReturn();

        // 更新 window.location 的值
        navigateToUrl(oldUrl);
        return;
      }

      // 移除 appsToUnload 中的应用
      const unloadPromises = appsToUnload.map(toUnloadPromise);

      // 卸载应用，更改状态，执行unmount生命周期函数
      const unmountUnloadPromises = appsToUnmount
        .map(toUnmountPromise)
        // 卸载完然后移除，通过注册微任务的方式实现
        .map((unmountPromise) => unmountPromise.then(toUnloadPromise));

      const allUnmountPromises = unmountUnloadPromises.concat(unloadPromises);
      const unmountAllPromise = Promise.all(allUnmountPromises);

      // 卸载全部完成后触发一个事件
      unmountAllPromise.then(() => {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
      });

      // 1、toLoadPromise：加载应用
      // 2、tryToBootstrapAndMount：卸载、初始化
      const loadThenMountPromises = appsToLoad.map((app) => {
        return toLoadPromise(app).then((app) =>
          tryToBootstrapAndMount(app, unmountAllPromise)
        );
      });

      // 3、tryToBootstrapAndMount：卸载、挂载
      const mountPromises = appsToMount
        .filter((appToMount) => appsToLoad.indexOf(appToMount) < 0)
        .map((appToMount) => {
          return tryToBootstrapAndMount(appToMount, unmountAllPromise);
        });

      // 后面就没啥了，可以理解为收尾工作
      return unmountAllPromise
        .catch((err) => {
          // 处理被延迟执行的事件监听
          callAllEventListeners();
          throw err;
        })
        .then(() => {
          // 处理被延迟执行的事件监听
          callAllEventListeners();

          // 现在需要卸载的应用程序已经卸载了，它们的DOM导航也被卸载了。 让剩余捕获的事件监听器处理DOM事件。
          return Promise.all(loadThenMountPromises.concat(mountPromises))
            .catch((err) => {
              pendingPromises.forEach((promise) => promise.reject(err));
              throw err;
            })
            .then(finishUpAndReturn);
        });
    });
  }

  // 执行、返回当前被 Active 的app
  function finishUpAndReturn() {
    // 重新执行当前被 Active 的app
    const returnValue = getMountedApps();
    pendingPromises.forEach((promise) => promise.resolve(returnValue));

    try {
      const appChangeEventName =
        appsThatChanged.length === 0
          ? "single-spa:no-app-change"
          : "single-spa:app-change";

      // 执行 'single-spa:no-app-change'、'single-spa:app-change
      window.dispatchEvent(
        new CustomEvent(appChangeEventName, getCustomEventDetail())
      );

      // 执行 'single-spa:routing-event'
      window.dispatchEvent(
        new CustomEvent("single-spa:routing-event", getCustomEventDetail())
      );
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }

    // 激活的 app 被执行完成，重置 appChangeUnderway 状态
    appChangeUnderway = false;

    if (peopleWaitingOnAppChange.length > 0) {
      // 当我们改道的时候，有人触发了另一条排队的改道。所以我们需要重新改变路线。
      const nextPendingPromises = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];
      reroute(nextPendingPromises);
    }

    return returnValue;
  }

  // 调用所有被延迟的事件侦听器
  function callAllEventListeners() {
    pendingPromises.forEach((pendingPromise) => {
      callCapturedEventListeners(pendingPromise.eventArguments);
    });

    callCapturedEventListeners(eventArguments);
  }

  // 返回已经注册应用的全部状态
  function getCustomEventDetail(isBeforeChanges = false, extraProperties) {
    const newAppStatuses = {}; // {[appName]: status}
    const appsByNewStatus = {
      [MOUNTED]: [], // [appName,...]
      [NOT_MOUNTED]: [],
      [NOT_LOADED]: [],
      [SKIP_BECAUSE_BROKEN]: [],
    };

    if (isBeforeChanges) {
      appsToLoad.concat(appsToMount).forEach((app) => {
        addApp(app, MOUNTED);
      });
      appsToUnload.forEach((app) => {
        addApp(app, NOT_LOADED);
      });
      appsToUnmount.forEach((app) => {
        addApp(app, NOT_MOUNTED);
      });
    } else {
      appsThatChanged.forEach((app) => {
        addApp(app);
      });
    }

    const result = {
      detail: {
        newAppStatuses, //
        appsByNewStatus,
        totalAppChanges: appsThatChanged.length,
        originalEvent: eventArguments?.[0],
        oldUrl,
        newUrl,
        navigationIsCanceled,
      },
    };

    if (extraProperties) {
      assign(result.detail, extraProperties);
    }

    return result;

    // 1、newAppStatuses - 以 appName 为 key、以 status 为value
    // 2、appsByNewStatus - 以应用名称为 status、以 appName 为value
    function addApp(app, status) {
      const appName = toName(app);
      status = status || getAppStatus(appName);
      newAppStatuses[appName] = status;
      const statusArr = (appsByNewStatus[status] =
        appsByNewStatus[status] || []);
      statusArr.push(appName);
    }
  }
}

// tryToBootstrapAndMount：卸载、初始化、挂载应用
function tryToBootstrapAndMount(app, unmountAllPromise) {
  // 一次判断为true，才会执行初始化
  if (shouldBeActive(app)) {
    // toBootstrapPromise：初始化应用
    return toBootstrapPromise(app).then((app) =>
      // 卸载某些应用
      unmountAllPromise.then(() =>
        // 第二次, 两次都为true才会去挂载
        shouldBeActive(app) ? toMountPromise(app) : app
      )
    );
  } else {
    // 卸载
    return unmountAllPromise.then(() => app);
  }
}
