(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
})(typeof self !== "undefined" ? self : this, function () {
  // preload 里 call 请求头的唯一物化口径（探活/清单测试桩也用它，
  // 保证断言建立在真实上线路径上，而不是在测试里另造一份规则）。
  //
  // 🔴 **省略通道**：apiKey === null 或 undefined 时**不建 AuthKey 键** ——
  //    探活 / 清单这类匿名请求连"空值的头"都不该出现（空值头也会被
  //    实例的鉴权层当成"带了凭据"去处理）。显式传空串仍物化成 ""
  //    （那是"明确声明带一个空密钥"，与省略是两种语义）。
  function buildCallHeaders(apiKey, body) {
    const headers = {};
    if (apiKey !== null && apiKey !== undefined) headers.AuthKey = apiKey || "";
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }
  return { buildCallHeaders: buildCallHeaders };
});
