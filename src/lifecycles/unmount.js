import {
  UNMOUNTING,
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

/**
 * 执行 unmount 生命周期函数
 * @param {*} appOrParcel => app
 * @param {*} hardFail => 索引
 */
export function toUnmountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 只卸载已挂载的应用
    if (appOrParcel.status !== MOUNTED) {
      return appOrParcel;
    }
    // 更改状态
    appOrParcel.status = UNMOUNTING;

    // 有关parcels的一些处理，没使用过parcels，所以 unmountChildrenParcels = []
    const unmountChildrenParcels = Object.keys(
      appOrParcel.parcels
    ).map((parcelId) => appOrParcel.parcels[parcelId].unmountThisParcel());

    let parcelError;

    return (
      Promise.all(unmountChildrenParcels)
        // 执行 unmount 生命周期函数
        .then(unmountAppOrParcel, (parcelError) => {
          return unmountAppOrParcel().then(() => {
            const parentError = Error(parcelError.message);
            if (hardFail) {
              throw transformErr(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
            } else {
              handleAppError(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
            }
          });
        })
        .then(() => appOrParcel)
    );

    // 执行 unmount
    function unmountAppOrParcel() {
      return reasonableTime(appOrParcel, "unmount")
        .then(() => {
          if (!parcelError) {
            appOrParcel.status = NOT_MOUNTED;
          }
        })
        .catch((err) => {
          if (hardFail) {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
    }
  });
}
