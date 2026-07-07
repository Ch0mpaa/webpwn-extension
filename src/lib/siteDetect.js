/*
 * WebPwn Coach — Site Detection
 * Figures out which learning platform we are on so the coach can frame
 * its guidance the right way (PortSwigger vs HTB vs Juice Shop, etc).
 *
 * Classic script (no ES modules) so it can be shared verbatim between the
 * content script and the popup. Everything hangs off globalThis.WPC.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const SITES = {
    portswigger: {
      id: "portswigger",
      label: "PortSwigger Web Security Academy",
      hostMatch: /portswigger\.net/i,
      badge: "PortSwigger Mode",
      tool: "Burp Suite",
    },
    htb: {
      id: "htb",
      label: "Hack The Box Academy",
      hostMatch: /hackthebox\.(com|eu)|\bhtb\b/i,
      badge: "HTB Mode",
      tool: "Pwnbox / Burp",
    },
    juiceshop: {
      id: "juiceshop",
      label: "OWASP Juice Shop",
      hostMatch: /juice-shop|juiceshop/i,
      titleMatch: /juice shop/i,
      badge: "Juice Shop Mode",
      tool: "Browser DevTools + Burp",
    },
    webpwn: {
      id: "webpwn",
      label: "WebPwn",
      hostMatch: /webpwn/i,
      titleMatch: /webpwn/i,
      badge: "WebPwn Mode",
      tool: "Your assessment toolkit",
    },
    dvwa: {
      id: "dvwa",
      label: "DVWA",
      hostMatch: /dvwa/i,
      titleMatch: /damn vulnerable web (app|application)|\bdvwa\b/i,
      badge: "DVWA Mode",
      tool: "Browser + Burp",
    },
  };

  /**
   * Detect the current platform.
   * @param {{host?:string, title?:string, bodyText?:string}} ctx
   * @returns {{id:string,label:string,badge:string,tool:string}}
   */
  function detectSite(ctx) {
    ctx = ctx || {};
    const host = (ctx.host || "").toLowerCase();
    const url = (ctx.url || "").toLowerCase();
    // host+url so we match even if only one is populated (never the extension's own origin)
    const hostUrl = (host + " " + url).trim() || (location.hostname || "").toLowerCase();
    const title = (ctx.title || "").toLowerCase();
    const body = (ctx.bodyText || "").toLowerCase();

    for (const key of Object.keys(SITES)) {
      const s = SITES[key];
      if (s.hostMatch && s.hostMatch.test(hostUrl)) return public_(s);
      if (s.titleMatch && s.titleMatch.test(title)) return public_(s);
      if (s.titleMatch && s.titleMatch.test(body.slice(0, 400))) return public_(s);
    }
    return {
      id: "generic",
      label: "Generic Web Application",
      badge: "Generic Mode",
      tool: "Browser DevTools + Burp",
    };
  }

  function public_(s) {
    return { id: s.id, label: s.label, badge: s.badge, tool: s.tool };
  }

  WPC.detectSite = detectSite;
  WPC.SITES = SITES;
})();
