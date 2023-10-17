import { reroute } from "./reroute.js";
import { find } from "../utils/find.js";
import { formatErrorMessage } from "../applications/app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { isStarted } from "../start.js";

// 捕获 "hashchange"、"popstate" 事件
const capturedEventListeners = {
  hashchange: [],
  popstate: [],
};

export const routingEventsListeningTo = ["hashchange", "popstate"];

/**
 * 1、解析传入的 navigate 对象、解析出 url
 * 2、给 window.location 上赋值 href、hash
 * 3、触发 window.history.pushState 事件
 * @param obj
 */
export function navigateToUrl(obj) {
  let url;
  if (typeof obj === "string") {
    url = obj;
  } else if (this && this.href) {
    url = this.href;
  } else if (
    obj &&
    obj.currentTarget &&
    obj.currentTarget.href &&
    obj.preventDefault
  ) {
    url = obj.currentTarget.href;
    // 阻止默认事件
    obj.preventDefault();
  } else {
    throw Error(
      formatErrorMessage(
        14,
        __DEV__ &&
          `singleSpaNavigate/navigateToUrl must be either called with a string url, with an <a> tag as its context, or with an event whose currentTarget is an <a> tag`
      )
    );
  }

  const current = parseUri(window.location.href);
  const destination = parseUri(url);

  if (url.indexOf("#") === 0) {
    // url 以 '#' 开头
    window.location.hash = destination.hash;
  } else if (current.host !== destination.host && destination.host) {
    // host 不相同
    if (process.env.BABEL_ENV === "test") {
      return { wouldHaveReloadedThePage: true };
    } else {
      // 在 window.location.href 上赋值
      window.location.href = url;
    }
  } else if (
    destination.pathname === current.pathname &&
    destination.search === current.search
  ) {
    // pathname、search 不相同
    window.location.hash = destination.hash;
  } else {
    // 触发页面跳转
    window.history.pushState(null, null, url);
  }
}

// 手动执行 capturedEventListeners 捕获的 "hashchange"、"popstate" 事件
export function callCapturedEventListeners(eventArguments) {
  if (eventArguments) {
    const eventType = eventArguments[0].type;
    if (routingEventsListeningTo.indexOf(eventType) >= 0) {
      capturedEventListeners[eventType].forEach((listener) => {
        try {
          listener.apply(this, eventArguments);
        } catch (e) {
          setTimeout(() => {
            throw e;
          });
        }
      });
    }
  }
}

// 是否只更改 url、不调用 reroute 方法
let urlRerouteOnly;

export function setUrlRerouteOnly(val) {
  urlRerouteOnly = val;
}

// 根据url重新卸载、挂载应用
function urlReroute() {
  reroute([], arguments);
}

/**
 * 通过装饰器模式
 * 1、增强 pushState 和 replaceState 方法
 * 2、除了原生的操作历史记录，还会调用 reroute
 */
function patchedUpdateState(updateState, methodName) {
  return function () {
    // 更新前的 url
    const urlBefore = window.location.href;
    // 执行 pushState 或者 replaceState 并返回结果
    const result = updateState.apply(this, arguments);
    // 更新后的 url
    const urlAfter = window.location.href;

    // 判断 urlRerouteOnly 或者 url 是否发生了变化
    if (!urlRerouteOnly || urlBefore !== urlAfter) {
      if (isStarted()) {
        // 触发 window.addEventListener("hashchange" | "popstate", urlReroute);
        window.dispatchEvent(
          createPopStateEvent(window.history.state, methodName)
        );
      } else {
        // 在 单spa 开始之前，不要触发人工popstate事件。
        reroute([]);
      }
    }

    return result;
  };
}

// 创建一个 PopStateEvent 事件
function createPopStateEvent(state, originalMethodName) {
  let evt;
  try {
    evt = new PopStateEvent("popstate", { state });
  } catch (err) {
    // IE 11
    evt = document.createEvent("PopStateEvent");
    evt.initPopStateEvent("popstate", false, false, state);
  }
  evt.singleSpa = true;
  evt.singleSpaTrigger = originalMethodName;
  return evt;
}

/**
 * 监听路由变化
 */
if (isInBrowser) {
  // 注册对于 hashchange 和 popstate 事件的监听
  window.addEventListener("hashchange", urlReroute);
  window.addEventListener("popstate", urlReroute);

  // 1、手动扩展原生的 addEventListener 和 removeEventListener 方法
  // 2、每次注册事件和事件处理函数都会将事件和处理函数保存下来，当然移除时也会做删除
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;

  // 添加事件
  window.addEventListener = function (eventName, fn) {
    if (typeof fn === "function") {
      if (
        routingEventsListeningTo.indexOf(eventName) >= 0 &&
        !find(capturedEventListeners[eventName], (listener) => listener === fn)
      ) {
        // 注册（保存）eventName 事件的处理函数
        capturedEventListeners[eventName].push(fn);
        return;
      }
    }
    return originalAddEventListener.apply(this, arguments);
  };

  // 移除事件
  window.removeEventListener = function (eventName, listenerFn) {
    if (typeof listenerFn === "function") {
      if (routingEventsListeningTo.indexOf(eventName) >= 0) {
        capturedEventListeners[eventName] = capturedEventListeners[
          eventName
        ].filter((fn) => fn !== listenerFn);
        return;
      }
    }
    // 原生方法
    return originalRemoveEventListener.apply(this, arguments);
  };

  // 拦截-增强 pushState 和 replaceState
  window.history.pushState = patchedUpdateState(
    window.history.pushState,
    "pushState"
  );
  window.history.replaceState = patchedUpdateState(
    window.history.replaceState,
    "replaceState"
  );

  if (window.singleSpaNavigate) {
    console.warn(
      formatErrorMessage(
        41,
        __DEV__ &&
          "single-spa has been loaded twice on the page. This can result in unexpected behavior."
      )
    );
  } else {
    // singleSpa暴露出来的一个全局方法，用户也可以基于它去判断子应用是运行在基座应用上还是独立运行
    window.singleSpaNavigate = navigateToUrl;
  }
}

// 创建 a 标签、赋值 href
function parseUri(str) {
  const anchor = document.createElement("a");
  anchor.href = str;
  return anchor;
}
