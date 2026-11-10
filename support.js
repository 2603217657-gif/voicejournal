(function (root, factory) {
  const support = factory();
  if (typeof module === "object" && module.exports) module.exports = support;
  else root.TreeholeSupport = support;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Curated local destinations only: never turn model output into a URL.
  const resources = Object.freeze({
    music: { title: "听一会儿舒缓音", duration: "3 分钟 · 离线可用", description: "轻柔的合成和声音景，点击后才播放；也可前往音乐平台挑选喜欢的音乐。", href: "relax.html?activity=music", action: "打开音乐放松" },
    breathing: { title: "跟着节奏，慢慢呼吸", duration: "1 分钟 · 离线可用", description: "轻轻吸气、缓缓呼气，不需要憋气。随时可以停下来。", href: "relax.html?activity=breathing", action: "开始呼吸练习" },
    grounding: { title: "把注意力带回此刻", duration: "2 分钟 · 离线可用", description: "跟着 5-4-3-2-1 感官练习，看看身边、感受脚下，给自己一点缓冲。", href: "relax.html?activity=grounding", action: "打开感官练习" },
    sleep: { title: "给睡前留一点安静", duration: "3 分钟 · 离线可用", description: "调暗灯光、暂放手机、记下一件明天再处理的事，按自己的节奏准备休息。", href: "relax.html?activity=sleep", action: "查看睡前小步骤" },
  });
  const crisisPattern = /自杀|轻生|不想活|想死|自残|伤害自己|结束生命|活不下去|不想醒来|不想再醒|一了百了/;
  const distressPattern = /状态(?:很|非常|特别|有点|一直)?(?:不好|不太好|不是很好|不佳|差|糟糕|糟)|心情(?:很|非常|特别|有点)?(?:不好|不太好|不是很好|差|糟糕|糟|低落)|不开心|不快乐|不高兴|不舒服|不好受|睡不着|睡不好|失眠|焦虑|紧张|恐慌|心慌|害怕|压力(?:很大|太大|大|重)?|喘不过气|难过|伤心|低落|郁闷|抑郁|委屈|孤独|孤单|寂寞|无助|无奈|崩溃|撑不住|烦躁|烦恼|烦|疲惫|疲倦|累|痛苦|难受|哭/g;

  function analyze(text) {
    text = typeof text === "string" ? text : "";
    if (crisisPattern.test(text)) return { crisis: true, distressed: true, category: "crisis" };
    const active = [];
    // A small offline rule set, not a clinical assessment. Ignore common negations.
    for (const clause of text.split(/[，。！？!?；;\n,]|但是|不过|可是|但/)) {
      distressPattern.lastIndex = 0;
      let match;
      while ((match = distressPattern.exec(clause))) {
        const before = clause.slice(0, match.index);
        if (/(?:没有|没|不再|不怎么|并不|不是|并非|不|无)(?:觉得|感到)?(?:那么|这么|很|太|再|什么)?$/.test(before)) continue;
        if (match[0] === "压力" && /^(?:不大|不重|不太大|还好)/.test(clause.slice(match.index + match[0].length))) continue;
        active.push(match[0]);
      }
    }
    const signal = active.join(" ");
    const category = /睡不着|睡不好|失眠/.test(signal) ? "sleep"
      : /焦虑|紧张|恐慌|心慌|害怕|压力|喘不过气/.test(signal) ? "anxiety"
      : /疲惫|疲倦|累/.test(signal) ? "tired" : "low";
    return { crisis: false, distressed: active.length > 0, category };
  }

  function recommend(text, mode = "warm") {
    const state = analyze(text);
    const declined = /(?:不想|不要|不需要|不用|别|不必).{0,8}(?:建议|链接|推荐|音乐|练习|开导)/.test(text);
    if (state.crisis || !state.distressed || ["no-advice", "quiet"].includes(mode) || declined) return [];
    if (state.category === "sleep") return ["sleep", "music"];
    if (state.category === "anxiety") return ["breathing", "grounding"];
    if (state.category === "tired") return ["music", "breathing"];
    return ["music", "grounding"];
  }

  function validIds(ids) {
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string" && Object.hasOwn(resources, id)))].slice(0, 2) : [];
  }

  return Object.freeze({ resources, analyze, recommend, validIds });
});
