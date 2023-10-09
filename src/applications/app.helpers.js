import { handleAppError } from "./app-errors.js";

// App statuses
export const NOT_LOADED = "NOT_LOADED"; // 应用注册了，还未加载
export const LOADING_SOURCE_CODE = "LOADING_SOURCE_CODE"; // 应用代码正在被拉取
export const NOT_BOOTSTRAPPED = "NOT_BOOTSTRAPPED"; // 应用已经加载，还未初始化
export const BOOTSTRAPPING = "BOOTSTRAPPING"; // 生命周期函数已经执行，还未结束
export const NOT_MOUNTED = "NOT_MOUNTED"; // 应用已经加载和初始化，还未挂载
export const MOUNTING = "MOUNTING"; // 应用正在被挂载，还未结束
export const MOUNTED = "MOUNTED"; // 应用目前处于激活状态，已经挂载到DOM元素上
export const UPDATING = "UPDATING"; //
export const UNMOUNTING = "UNMOUNTING"; // 应用正在被卸载，还未结束
export const UNLOADING = "UNLOADING"; // 应用正在被移除，还未结束
export const LOAD_ERROR = "LOAD_ERROR"; // 应用的加载功能返回了一个rejected的Promise，这通常是由于下载应用程序的javascript包时出现网络错误造成的。
export const SKIP_BECAUSE_BROKEN = "SKIP_BECAUSE_BROKEN"; // 应用在加载、初始化、挂载或卸载过程中抛出错误，由于行为不当而被跳过，因此被隔离。其他应用将正常运行。

// 判断是否处于激活状态，已经挂载到DOM元素上
export function isActive(app) {
  return app.status === MOUNTED;
}

// 判断应用是否应该被激活
export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}

// 返回应用名称
export function toName(app) {
  return app.name;
}

// 判断是否微 parcel 形式
export function isParcel(appOrParcel) {
  return Boolean(appOrParcel.unmountThisParcel);
}

// 返回微应用类型
export function objectType(appOrParcel) {
  return isParcel(appOrParcel) ? "parcel" : "application";
}
