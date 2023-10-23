import {
  UPDATING,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import {
  transformErr,
  formatErrorMessage,
} from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

/**
 * 1、更新应用
 * 2、调用 app.update 钩子函数
 * 3、更改 appOrParcel.status 状态值
 * @param parcel
 * @returns {Promise<unknown>}
 */
export function toUpdatePromise(parcel) {
  return Promise.resolve().then(() => {
    if (parcel.status !== MOUNTED) {
      throw Error(
        formatErrorMessage(
          32,
          __DEV__ &&
            `Cannot update parcel '${toName(
              parcel
            )}' because it is not mounted`,
          toName(parcel)
        )
      );
    }

    parcel.status = UPDATING;

    return reasonableTime(parcel, "update")
      .then(() => {
        parcel.status = MOUNTED;
        return parcel;
      })
      .catch((err) => {
        throw transformErr(err, parcel, SKIP_BECAUSE_BROKEN);
      });
  });
}
