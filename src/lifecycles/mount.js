import {
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";
import CustomEvent from "custom-event";
import { toUnmountPromise } from "./unmount.js";

let beforeFirstMountFired = false;
let firstMountFired = false;

/**
 * 1、挂载应用
 * 2、调用 app.mount 钩子函数
 * 3、更改 appOrParcel.status 状态值
 * @param appOrParcel
 * @param hardFail
 * @returns {Promise<void>}
 */
export function toMountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 已经挂载过，直接返回
    if (appOrParcel.status !== NOT_MOUNTED) {
      return appOrParcel;
    }

    // 首次挂载前执行 "single-spa:before-first-mount" 事件
    if (!beforeFirstMountFired) {
      window.dispatchEvent(new CustomEvent("single-spa:before-first-mount"));
      beforeFirstMountFired = true;
    }

    // 执行挂载函数
    return reasonableTime(appOrParcel, "mount")
      .then(() => {
        appOrParcel.status = MOUNTED;

        // single-spa 其实在不同的阶段提供了相应的自定义事件，让用户可以做一些事情
        if (!firstMountFired) {
          window.dispatchEvent(new CustomEvent("single-spa:first-mount"));
          firstMountFired = true;
        }

        return appOrParcel;
      })
      .catch((err) => {
        // 如果我们挂载appOrParcel失败，我们应该在放入SKIP_BECAUSE_BROKEN之前尝试卸载它
        appOrParcel.status = MOUNTED;
        return toUnmountPromise(appOrParcel, true).then(
          setSkipBecauseBroken,
          setSkipBecauseBroken
        );

        function setSkipBecauseBroken() {
          if (!hardFail) {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
            return appOrParcel;
          } else {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        }
      });
  });
}
