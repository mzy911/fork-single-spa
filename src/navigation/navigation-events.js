import { reroute } from "./reroute.js";
import { find } from "../utils/find.js";
import { formatErrorMessage } from "../applications/app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { isStarted } from "../start.js";

// 捕获导航事件监听器
const capturedEventListeners = {
  hashchange: [],
  popstate: [],
};

export const routingEventsListeningTo = ["hashchange", "popstate"];

/**
 * 1、解析传入的 navigate 对象
 * 2、往 window.location 上赋值 href、hash
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

  // url 以 '#' 开头
  if (url.indexOf("#") === 0) {
    window.location.hash = destination.hash;
  }
  // host 不相同
  else if (current.host !== destination.host && destination.host) {
    if (process.env.BABEL_ENV === "test") {
      return { wouldHaveReloadedThePage: true };
    } else {
      // 在 window.location.href 上赋值
      window.location.href = url;
    }
  }
  // pathname、search 不相同
  else if (
    destination.pathname === current.pathname &&
    destination.search === current.search
  ) {
    window.location.hash = destination.hash;
  }
  // 触发页面跳转
  else {
    window.history.pushState(null, null, url);
  }
}

// 执行捕获的事件监听器 - "hashchange", "popstate"
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

// 重复的url
let urlRerouteOnly;

export function setUrlRerouteOnly(val) {
  urlRerouteOnly = val;
}

function urlReroute() {
  reroute([], arguments);
}

/**
 * 通过装饰器模式
 * 1、增强 pushState 和 replaceState 方法
 * 2、除了原生的操作历史记录，还会调用 reroute
 * @param {*} updateState window.history.pushstate/replacestate
 * @param {*} methodName 'pushstate' or 'replacestate'
 */
function patchedUpdateState(updateState, methodName) {
  return function () {
    // 更新前的 url
    const urlBefore = window.location.href;
    // 执行 pushState 或者 replaceState 并返回结果
    const result = updateState.apply(this, arguments);
    // 更新后的 url
    const urlAfter = window.location.href;

    if (!urlRerouteOnly || urlBefore !== urlAfter) {
      if (isStarted()) {
        // 一旦单spa启动，触发人工popstate事件，这样单spa应用就知道路由了发生在不同的应用程序中
        window.dispatchEvent(
          createPopStateEvent(window.history.state, methodName)
        );
      } else {
        // 在单spa开始之前，不要触发人工popstate事件。
        // 因为没有单个spa应用程序需要知道路由事件
        // 在自己的路由器之外。
        reroute([]);
      }
    }

    return result;
  };
}

// 创建 PopState 事件
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
  window.addEventListener("hashchange", urlReroute);
  window.addEventListener("popstate", urlReroute);

  // Monkeypatch addEventListener so that we can ensure correct timing
  /**
   * 扩展原生的addEventListener和removeEventListener方法
   * 每次注册事件和事件处理函数都会将事件和处理函数保存下来，当然移除时也会做删除
   * */
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;

  // 添加事件监听
  window.addEventListener = function (eventName, fn) {
    if (typeof fn === "function") {
      if (
        // eventName 只能是 hashchange或popstate && 对应事件的fn注册函数没有注册
        routingEventsListeningTo.indexOf(eventName) >= 0 &&
        !find(capturedEventListeners[eventName], (listener) => listener === fn)
      ) {
        // 注册（保存）eventName 事件的处理函数
        capturedEventListeners[eventName].push(fn);
        return;
      }
    }

    // 原生方法
    return originalAddEventListener.apply(this, arguments);
  };

  // 移除事件
  window.removeEventListener = function (eventName, listenerFn) {
    if (typeof listenerFn === "function") {
      // 从captureEventListeners数组中移除eventName事件指定的事件处理函数
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

  // 增强 pushState 和 replaceState
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
