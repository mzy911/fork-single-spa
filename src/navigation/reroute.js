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
 * 每次切换路由前，将应用分为4大类，
 * 首次加载时执行loadApp
 * 后续的路由切换执行performAppChange
 * 为四大类的应用分别执行相应的操作，比如更改app.status，执行生命周期函数
 * 所以，从这里也可以看出来，single-spa就是一个维护应用的状态机
 * @param {*} pendingPromises
 * @param {*} eventArguments
 */
export function reroute(pendingPromises = [], eventArguments) {
  // 有应用正在切换，新增变更添加到 peopleWaitingOnAppChange 中
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  // 将应用分为4大类
  const {
    appsToUnload, // 需要被移除的
    appsToUnmount, // 需要被卸载的
    appsToLoad, // 需要被加载的
    appsToMount, // 需要被挂载的
  } = getAppChanges();

  let appsThatChanged,
    navigationIsCanceled = false,
    oldUrl = currentUrl,
    newUrl = (currentUrl = window.location.href);

  // 切换操作、非首次加载
  if (isStarted()) {
    // 开始切换新的应用
    appChangeUnderway = true;

    // 所有需要被改变的的应用
    appsThatChanged = appsToUnload.concat(
      appsToLoad,
      appsToUnmount,
      appsToMount
    );
    // 执行改变
    return performAppChanges();
  } else {
    // 去加载
    appsThatChanged = appsToLoad;

    // 加载 Apps
    return loadApps();
  }

  function cancelNavigation() {
    navigationIsCanceled = true;
  }

  // 整体返回一个立即resolved的promise，通过微任务来加载apps
  function loadApps() {
    return Promise.resolve().then(() => {
      // 加载每个子应用，并做一系列的状态变更和验证（比如结果为promise、子应用要导出生命周期函数）
      const loadPromises = appsToLoad.map(toLoadPromise);

      return (
        // 保证所有加载子应用的微任务执行完成
        Promise.all(loadPromises)
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

  function performAppChanges() {
    return Promise.resolve().then(() => {
      window.dispatchEvent(
        new CustomEvent(
          appsThatChanged.length === 0
            ? "single-spa:before-no-app-change"
            : "single-spa:before-app-change",
          getCustomEventDetail(true)
        )
      );

      window.dispatchEvent(
        new CustomEvent(
          "single-spa:before-routing-event",
          getCustomEventDetail(true, { cancelNavigation })
        )
      );

      if (navigationIsCanceled) {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
        finishUpAndReturn();
        navigateToUrl(oldUrl);
        return;
      }

      // 移除应用
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

      // 等到所有应用都卸载完成后才挂载应用、因为 JS 是单线程的
      const loadThenMountPromises = appsToLoad.map((app) => {
        return toLoadPromise(app).then((app) =>
          tryToBootstrapAndMount(app, unmountAllPromise)
        );
      });

      /*
       * 这些应用程序已经启动，只是需要被安装。
       * 他们各自等待所有卸载应用程序完成在他们挂载之前。
       * 初始化和挂载app，其实做的事情很简单，就是改变app.status，执行生命周期函数
       * 当然这里的初始化和挂载其实是前后脚一起完成的(只要中间用户没有切换路由)
       */
      const mountPromises = appsToMount
        .filter((appToMount) => appsToLoad.indexOf(appToMount) < 0)
        .map((appToMount) => {
          return tryToBootstrapAndMount(appToMount, unmountAllPromise);
        });

      // 后面就没啥了，可以理解为收尾工作
      return unmountAllPromise
        .catch((err) => {
          callAllEventListeners();
          throw err;
        })
        .then(() => {
          // 现在需要卸载的应用程序已经卸载了，它们的DOM导航也被卸载了。 让剩余捕获的事件监听器处理DOM事件。
          callAllEventListeners();
          return Promise.all(loadThenMountPromises.concat(mountPromises))
            .catch((err) => {
              pendingPromises.forEach((promise) => promise.reject(err));
              throw err;
            })
            .then(finishUpAndReturn);
        });
    });
  }

  function finishUpAndReturn() {
    const returnValue = getMountedApps();
    pendingPromises.forEach((promise) => promise.resolve(returnValue));

    try {
      const appChangeEventName =
        appsThatChanged.length === 0
          ? "single-spa:no-app-change"
          : "single-spa:app-change";
      window.dispatchEvent(
        new CustomEvent(appChangeEventName, getCustomEventDetail())
      );
      window.dispatchEvent(
        new CustomEvent("single-spa:routing-event", getCustomEventDetail())
      );
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }

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

  // 获取自定义事件详情
  function getCustomEventDetail(isBeforeChanges = false, extraProperties) {
    const newAppStatuses = {};
    const appsByNewStatus = {
      [MOUNTED]: [],
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
        newAppStatuses,
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

// 试着初始化、挂载应用
function tryToBootstrapAndMount(app, unmountAllPromise) {
  if (shouldBeActive(app)) {
    // 一次判断为true，才会执行初始化
    return toBootstrapPromise(app).then((app) =>
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
