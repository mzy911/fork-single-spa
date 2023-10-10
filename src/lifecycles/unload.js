import {
  NOT_MOUNTED,
  UNLOADING,
  NOT_LOADED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { handleAppError } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

const appsToUnload = {};

/**
 * 1、移除应用
 * 2、更改应用的状态
 * 3、执行 unload 生命周期函数，执行清理操作
 * */
export function toUnloadPromise(app) {
  return Promise.resolve().then(() => {
    const unloadInfo = appsToUnload[toName(app)];

    // appsToUnload 中找不到应用、直接返回 app
    if (!unloadInfo) {
      return app;
    }

    // 已经卸载了，执行一些清理操作
    if (app.status === NOT_LOADED) {
      finishUnloadingApp(app, unloadInfo);
      return app;
    }

    // 已经卸载了，执行一些清理操作
    if (app.status === UNLOADING) {
      return unloadInfo.promise.then(() => app);
    }

    if (app.status !== NOT_MOUNTED && app.status !== LOAD_ERROR) {
      return app;
    }

    const unloadPromise =
      app.status === LOAD_ERROR
        ? Promise.resolve()
        : reasonableTime(app, "unload");

    // 更改状态为 UNLOADING
    app.status = UNLOADING;

    // 在合理的时间范围内执行生命周期函数
    return unloadPromise
      .then(() => {
        finishUnloadingApp(app, unloadInfo);
        return app;
      })
      .catch((err) => {
        errorUnloadingApp(app, unloadInfo, err);
        return app;
      });
  });
}

/**
 * 1、移除完成，执行一些清理动作，其实就是从appsToUnload数组中移除该app
 * 2、移除生命周期函数，更改 app.status
 * 3、但应用不是真的被移除，后面再激活时不需要重新去下载资源,，只是做一些状态上的变更
 * @param app
 * @param unloadInfo
 * */
function finishUnloadingApp(app, unloadInfo) {
  // 移除
  delete appsToUnload[toName(app)];

  // 移除生命周期函数
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  // 更改状态
  app.status = NOT_LOADED;

  // 调用 unloadApplication
  unloadInfo.resolve();
}

// 卸载失败
function errorUnloadingApp(app, unloadInfo, err) {
  delete appsToUnload[toName(app)];

  // 移除生命周期函数
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  handleAppError(err, app, SKIP_BECAUSE_BROKEN);
  unloadInfo.reject(err);
}

// 将要准备移除的应用添加到 appsToUnload 的对象上
export function addAppToUnload(app, promiseGetter, resolve, reject) {
  appsToUnload[toName(app)] = { app, resolve, reject };
  Object.defineProperty(appsToUnload[toName(app)], "promise", {
    get: promiseGetter,
  });
}

// 获取将要准备移除的应用的 Info
export function getAppUnloadInfo(appName) {
  return appsToUnload[appName];
}
