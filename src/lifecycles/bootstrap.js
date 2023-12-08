import {
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { reasonableTime } from "../applications/timeouts.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";

/**
 * 1、初始化 app 在 start 之前调用
 * 2、调用子应用注入的 app.bootstrap 钩子函数
 * 3、更改 app.status 值
 */
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 始化过的 app 被直接返回
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel;
    }

    // 将状态改为正在初始化...
    appOrParcel.status = BOOTSTRAPPING;

    // 子应用没有注入 app.bootstrap 钩子
    if (!appOrParcel.bootstrap) {
      return Promise.resolve().then(successfulBootstrap);
    }

    // 执行 bootstrap 生命周期
    return reasonableTime(appOrParcel, "bootstrap")
      .then(successfulBootstrap)
      .catch((err) => {
        if (hardFail) {
          throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        } else {
          handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          return appOrParcel;
        }
      });
  });

  function successfulBootstrap() {
    // 更改状态：应用已经加载和初始化、还未挂载
    appOrParcel.status = NOT_MOUNTED;
    return appOrParcel;
  }
}
