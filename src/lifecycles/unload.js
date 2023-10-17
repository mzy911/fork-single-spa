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

    // 已经被移除了、直接返回 app
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
 * 完成移除应用操作
 * 1、从 appsToUnload 对象中中去掉应用
 * 2、移除生命周期函数
 * 3、更新应用状态为 NOT_LOADED
 * 4、调用 unloadApplication
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
