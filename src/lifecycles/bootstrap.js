import {
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { reasonableTime } from "../applications/timeouts.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";

/**
 * 1、初始化 app
 * 2、更改 app.status
 * 3、在合理的时间内执行bootstrap生命周期函数
 */
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 始化过的 app 被直接返回
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel;
    }

    // 将状态改为正在初始化...
    appOrParcel.status = BOOTSTRAPPING;

    // 初始化完成
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
