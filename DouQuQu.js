/*
 * DouQuQu.js —— 无差别攻击模式控制（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 指令：
 *   /douququ <BOSS名字>   让指定脚本 BOSS 进入无差别攻击模式
 *   /douququ all          让所有已注册脚本 BOSS 进入无差别攻击模式
 *   /douququ off <名字|all> 关闭无差别攻击模式
 *   /douququ list         查看当前开启状态
 *
 * 说明：
 *   - 状态保存到主世界 PersistentDataContainer，脚本/服务器重载后保留。
 *   - 通过 getShared("DouQuQu") 向 BOSS 脚本提供 isActive / markEntity /
 *     isActiveEntity 等 API；BOSS 脚本在无差别模式下会锁定非玩家生物，
 *     并允许脚本 BOSS 之间互相造成伤害。
 */
(function () {
    "use strict";

    var ChatColor = Java.type("org.bukkit.ChatColor");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");

    var STATE_KEY = new NamespacedKey(plugin, "douququ_state");

    var allActive = false;
    var activeBosses = {};   // bossId -> true
    var activeEntities = {}; // entityUuid -> bossId，用于判断“攻击者是不是无差别模式 BOSS”

    function mainWorld() {
        try { return Bukkit.getWorlds().get(0); } catch (e) { return null; }
    }

    function entityUuid(entityOrUuid) {
        try {
            if (entityOrUuid == null) return null;
            return String(entityOrUuid.getUniqueId().toString());
        } catch (e) {
            return String(entityOrUuid);
        }
    }

    function isActive(bossId) {
        var key = String(bossId == null ? "" : bossId);
        return allActive || activeBosses[key] === true;
    }

    function loadState() {
        try {
            var world = mainWorld();
            if (!world) return;
            var pdc = world.getPersistentDataContainer();
            if (!pdc.has(STATE_KEY, PersistentDataType.STRING)) return;
            var raw = String(pdc.get(STATE_KEY, PersistentDataType.STRING));
            if (!raw) return;
            var parts = raw.split("[|]");
            for (var i = 0; i < parts.length; i++) {
                var part = String(parts[i]);
                if (part === "all") allActive = true;
                else if (part.length > 0) activeBosses[part] = true;
            }
        } catch (e) { }
    }

    function saveState() {
        try {
            var world = mainWorld();
            if (!world) return;
            var parts = [];
            if (allActive) parts.push("all");
            for (var id in activeBosses) {
                if (activeBosses.hasOwnProperty(id) && activeBosses[id]) parts.push(id);
            }
            world.getPersistentDataContainer().set(STATE_KEY, PersistentDataType.STRING,
                    parts.join("|"));
        } catch (e) { }
    }

    var api = {
        version: 1,

        isActive: isActive,
        isAll: function () { return allActive; },

        // BOSS 脚本每 tick 把自己的载具/碰撞箱登记进来，便于判断伤害来源
        markEntity: function (bossId, entityOrUuid) {
            try {
                if (!isActive(bossId)) return;
                var uuid = entityUuid(entityOrUuid);
                if (uuid) activeEntities[uuid] = String(bossId);
            } catch (e) { }
        },

        unmarkEntity: function (entityOrUuid) {
            try {
                var uuid = entityUuid(entityOrUuid);
                if (uuid) delete activeEntities[uuid];
            } catch (e) { }
        },

        // 判断某个实体（或其 UUID）是否属于当前开启无差别模式的 BOSS
        isActiveEntity: function (entityOrUuid) {
            try {
                var uuid = entityUuid(entityOrUuid);
                if (!uuid) return false;
                var owner = activeEntities[uuid];
                return owner ? isActive(owner) : false;
            } catch (e) { return false; }
        },

        enableBoss: function (bossId) {
            if (!bossId) return;
            activeBosses[String(bossId)] = true;
            saveState();
        },

        disableBoss: function (bossId) {
            if (!bossId) return;
            delete activeBosses[String(bossId)];
            saveState();
        },

        enableAll: function () {
            allActive = true;
            saveState();
        },

        disableAll: function () {
            allActive = false;
            activeBosses = {};
            activeEntities = {};
            saveState();
        },

        listActive: function () {
            var list = [];
            if (allActive) list.push("all");
            for (var id in activeBosses) {
                if (activeBosses.hasOwnProperty(id) && activeBosses[id]) list.push(id);
            }
            return list;
        }
    };

    setShared("DouQuQu", api);
    loadState();

    // ---------------------------------------------------------------------------
    // 指令实现
    // ---------------------------------------------------------------------------

    function registryApi() {
        try { return getShared("BossRegistry"); } catch (e) { return null; }
    }

    function bossNameById(api, id) {
        try {
            if (api != null && typeof api.getName === "function") {
                return String(api.getName(String(id)));
            }
        } catch (e) { }
        return String(id);
    }

    // 兼容旧版 CallBoss（resolve 返回 def 对象 / {ambiguous}）与
    // 新版 CallBoss（resolve 返回 id 字符串；无匹配和多个前缀匹配都返回 null）。
    function resolveBoss(query) {
        var api = registryApi();
        if (!api) return null;
        var q = String(query == null ? "" : query).trim();
        if (q.length === 0) return null;

        try {
            var resolved = api.resolve(q);
            if (resolved != null) {
                if (typeof resolved === "object") return resolved;
                var id = String(resolved);
                return { id: id, name: bossNameById(api, id) };
            }

            // 新版 resolve 对“未找到”和“前缀不唯一”都返回 null，这里补回歧义提示。
            if (typeof api.list === "function") {
                var ids = api.list();
                var prefixMatches = [];
                var lower = q.toLowerCase();
                for (var i = 0; i < ids.length; i++) {
                    var item = ids[i];
                    var idText = String(item);
                    var name = bossNameById(api, idText);
                    var aliases = null;
                    try {
                        if (typeof api.getAliases === "function") aliases = api.getAliases(idText);
                    } catch (e) { }
                    var keys = [idText, name];
                    if (aliases != null) {
                        for (var a = 0; a < aliases.size(); a++) keys.push(String(aliases.get(a)));
                    }
                    var exact = false;
                    var prefix = false;
                    for (var k = 0; k < keys.length; k++) {
                        var key = String(keys[k]).toLowerCase();
                        if (key === lower) { exact = true; break; }
                        if (key.indexOf(lower) === 0) prefix = true;
                    }
                    if (exact) return { id: idText, name: name };
                    if (prefix) prefixMatches.push({ id: idText, name: name });
                }
                if (prefixMatches.length === 1) return prefixMatches[0];
                if (prefixMatches.length > 1) return { ambiguous: prefixMatches };
            }
        } catch (e) { }
        return null;
    }

    function joinArgs(args, start) {
        var parts = [];
        for (var i = start; i < args.length; i++) parts.push(String(args[i]));
        return parts.join(" ");
    }

    function listBossNames() {
        var names = [];
        var api = registryApi();
        if (!api) return names;
        try {
            var list = api.list();
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                var idText = (item != null && typeof item === "object") ? String(item.id) : String(item);
                var name = (item != null && typeof item === "object" && item.name != null)
                        ? String(item.name) : bossNameById(api, idText);
                names.push(name);
            }
        } catch (e) { }
        return names;
    }

    function listActiveNames() {
        var names = [];
        if (allActive) names.push("全部脚本 BOSS");
        var api = registryApi();
        for (var id in activeBosses) {
            if (!activeBosses.hasOwnProperty(id) || !activeBosses[id]) continue;
            var name = id;
            if (api) {
                try {
                    if (typeof api.getName === "function") {
                        name = bossNameById(api, id);
                    } else {
                        var def = api.get(id);
                        if (def && def.name) name = String(def.name);
                    }
                } catch (e) { }
            }
            names.push(name);
        }
        return names;
    }

    function sendUsage(sender) {
        sender.sendMessage(ChatColor.GOLD + "===== 无差别攻击模式 =====");
        sender.sendMessage(ChatColor.YELLOW + "/douququ <BOSS名字>"
                + ChatColor.GRAY + " —— 让指定脚本 BOSS 无差别攻击所有生物");
        sender.sendMessage(ChatColor.YELLOW + "/douququ all"
                + ChatColor.GRAY + " —— 所有脚本 BOSS 无差别攻击所有生物");
        sender.sendMessage(ChatColor.YELLOW + "/douququ off <名字|all>"
                + ChatColor.GRAY + " —— 关闭无差别攻击模式");
        sender.sendMessage(ChatColor.YELLOW + "/douququ list"
                + ChatColor.GRAY + " —— 查看当前开启状态");
    }

    function sendStatus(sender) {
        var names = listActiveNames();
        if (names.length === 0) {
            sender.sendMessage(ChatColor.RED + "当前没有 BOSS 开启无差别攻击模式。");
        } else {
            sender.sendMessage(ChatColor.GOLD + "无差别攻击模式已开启：" + ChatColor.YELLOW
                    + names.join("、"));
        }
    }

    addCommand("douququ", {
        onCommand: function (sender, args) {
            try {
                if (!args || args.length === 0) {
                    sendUsage(sender);
                    sendStatus(sender);
                    return;
                }

                var first = String(args[0]).toLowerCase();

                if (first === "all") {
                    api.enableAll();
                    sender.sendMessage(ChatColor.GREEN + "所有已注册脚本 BOSS 已进入"
                            + ChatColor.RED + "无差别攻击模式" + ChatColor.GREEN + "。");
                    return;
                }

                if (first === "list") {
                    sendStatus(sender);
                    return;
                }

                if (first === "off") {
                    if (args.length < 2) {
                        sendUsage(sender);
                        return;
                    }
                    var offArg = String(args[1]).toLowerCase();
                    if (offArg === "all") {
                        api.disableAll();
                        sender.sendMessage(ChatColor.GREEN + "已关闭所有脚本 BOSS 的无差别攻击模式。");
                        return;
                    }
                    var offQuery = joinArgs(args, 1);
                    var offDef = resolveBoss(offQuery);
                    if (!offDef) {
                        sender.sendMessage(ChatColor.RED + "找不到 BOSS：" + ChatColor.YELLOW + offQuery);
                        return;
                    }
                    if (offDef.ambiguous) {
                        sender.sendMessage(ChatColor.RED + "匹配到多个 BOSS，请输入完整名字：");
                        for (var j = 0; j < offDef.ambiguous.length; j++) {
                            sender.sendMessage(ChatColor.YELLOW + " - " + offDef.ambiguous[j].name);
                        }
                        return;
                    }
                    api.disableBoss(offDef.id);
                    sender.sendMessage(ChatColor.GREEN + "已关闭 " + ChatColor.GOLD + offDef.name
                            + ChatColor.GREEN + " 的无差别攻击模式。");
                    return;
                }

                var query = joinArgs(args, 0);
                var def = resolveBoss(query);
                if (!def) {
                    sender.sendMessage(ChatColor.RED + "找不到 BOSS：" + ChatColor.YELLOW + query
                            + ChatColor.RED + "。使用 /call boss 查看列表。");
                    return;
                }
                if (def.ambiguous) {
                    sender.sendMessage(ChatColor.RED + "匹配到多个 BOSS，请输入完整名字：");
                    for (var k = 0; k < def.ambiguous.length; k++) {
                        sender.sendMessage(ChatColor.YELLOW + " - " + def.ambiguous[k].name);
                    }
                    return;
                }

                if (isActive(def.id)) {
                    sender.sendMessage(ChatColor.YELLOW + def.name
                            + ChatColor.GREEN + " 已经处于无差别攻击模式。");
                    return;
                }
                api.enableBoss(def.id);
                sender.sendMessage(ChatColor.GREEN + "BOSS " + ChatColor.GOLD + def.name
                        + ChatColor.GREEN + " 已进入" + ChatColor.RED + "无差别攻击模式"
                        + ChatColor.GREEN + "：会锁定玩家、普通生物和其他脚本 BOSS。");
            } catch (e) {
                sender.sendMessage(ChatColor.RED + "DouQuQu 指令异常：" + e);
            }
        },

        onTabComplete: function (sender, args) {
            var result = [];
            try {
                var prefix = "";
                if (args && args.length >= 1) prefix = String(args[args.length - 1]).toLowerCase();

                if (!args || args.length <= 1) {
                    result.push("all");
                    result.push("off");
                    result.push("list");
                    var names = listBossNames();
                    for (var i = 0; i < names.length; i++) {
                        if (!prefix || names[i].toLowerCase().indexOf(prefix) === 0) {
                            result.push(names[i]);
                        }
                    }
                    return toJavaList(result);
                }

                if (String(args[0]).toLowerCase() === "off" && args.length === 2) {
                    if (!prefix || "all".indexOf(prefix) === 0) result.push("all");
                    var offNames = listBossNames();
                    for (var j = 0; j < offNames.length; j++) {
                        if (!prefix || offNames[j].toLowerCase().indexOf(prefix) === 0) {
                            result.push(offNames[j]);
                        }
                    }
                }
            } catch (e) { }
            return toJavaList(result);
        }
    });

    log.info("DouQuQu 已加载：/douququ <BOSS名字|all>，/douququ off <名字|all>，/douququ list");
})();
