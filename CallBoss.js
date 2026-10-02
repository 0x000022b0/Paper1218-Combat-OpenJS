/*
 * CallBoss.js —— 通用 BOSS 召唤框架（OpenJS 1.5.0）
 *
 * 获取方式：/call boss <显示名>      获取对应 BOSS 的召唤绿宝石
 *           /call boss              列出当前可用 BOSS
 * 召唤方式：手持绿宝石右键地面 → 6 秒倒计时 → 调用该 BOSS 的 spawn(location, player)
 *
 * 召唤物约定（2026-09-29 起，后续所有自定义怪物统一遵守）：
 *     材质：绿宝石（EMERALD）
 *     名称：就是怪物自己的名字（例如「无爵骑士」），不再加「召唤」前缀
 *     简介：lore 中带 BOSS id、右键说明，以及该 BOSS 注册时提交的简介行
 *
 * ========================= 实测重要结论（契约补充） =========================
 * OpenJS 1.5.0 每个脚本拥有独立的 Nashorn ScriptEngine。经本机实测：
 *
 *   1) 跨引擎【调用方法】可靠：getShared("BossRegistry").register(...) 正常工作；
 *   2) 跨引擎【读取对象属性】不可靠：把另一个脚本创建的 JS 对象存进本脚本的
 *      JS 容器（对象 / 数组）后再取出来读属性，会读到错误的宿主对象
 *      （实测现象：注册表中 inferno_foehn 与 frost_warden 两个条目都返回
 *      frost_warden 的 id/name，且 def.spawn 调用到了错误的脚本）。
 *
 * 因此本框架的注册表只保存【Java 值】：字符串存 java.util.HashMap，
 * 别名 / 简介存 java.util.ArrayList，spawn 函数在注册瞬间用
 * Java.extend(java.util.function.BiFunction) 包成真正的 Java 适配器对象，
 * 之后一切都通过 Java 方法调用与 Java 容器完成，绝不再保存 JS 对象。
 * ==========================================================================
 *
 * 共享 API（getShared("BossRegistry")，version = 1）：
 *   api.version                        接口版本号
 *   api.register(def)                  注册 BOSS（对象形式，契约 6.7 兼容）
 *   api.register(id, name, aliases,
 *                lore, spawnFn)        注册 BOSS（位置参数形式，跨引擎最稳）
 *   api.unregister(idOrDef)            注销
 *   api.heartbeat(id)                  刷新心跳（超过 10 秒未刷新视为脚本失效）
 *   api.has(id)                        该 BOSS 是否已注册且心跳正常
 *   api.list()                         返回存活 BOSS 的 id 字符串数组
 *   api.getName(id)                    返回显示名
 *   api.getAliases(id)                 返回别名数组
 *   api.describe(id)                   返回 Java List<String> 人读描述
 *   api.resolve(nameOrAlias)           按 id / 显示名 / 别名 / 唯一前缀解析出 id
 *   api.createStick(id)                生成召唤绿宝石
 *   api.spawn(id, location, player)    直接召唤，返回 boolean
 *
 * 契约依据：《OpenJS脚本数据契约.md》第 5.2、6.6、6.7、7.4 节。
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var Enchantment = Java.type("org.bukkit.enchantments.Enchantment");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var Location = Java.type("org.bukkit.Location");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var EquipmentSlot = Java.type("org.bukkit.inventory.EquipmentSlot");
    var ItemFlag = Java.type("org.bukkit.inventory.ItemFlag");
    var UUIDClass = Java.type("java.util.UUID");
    var EventResult = Java.type("org.bukkit.event.Event$Result");
    var BiFunction = Java.type("java.util.function.BiFunction");
    var HashMap = Java.type("java.util.HashMap");
    var ArrayList = Java.type("java.util.ArrayList");
    var ConcurrentHashMap = Java.type("java.util.concurrent.ConcurrentHashMap");
    var LinkedHashMap = Java.type("java.util.LinkedHashMap");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var REGISTRY_NAME = "BossRegistry";
    var REGISTRY_VERSION = 1;

    var SUMMON_COUNTDOWN_SECONDS = 6;
    var SUMMON_COUNTDOWN_TICKS = SUMMON_COUNTDOWN_SECONDS * 20; // 120 tick
    var SUMMON_ANNOUNCE_INTERVAL_TICKS = 20;                    // 每秒播报一次

    var HEARTBEAT_TIMEOUT_MS = 10000;   // 超过 10 秒无心跳视为脚本失效
    var HEARTBEAT_INTERVAL_TICKS = 20;  // 框架自身心跳

    var STICK_USE_COOLDOWN_TICKS = 20;  // 同一玩家两次右键的最小间隔
    var SPAWN_CLEARANCE_HEIGHT = 3;     // 生成点必须有的净空高度

    // -----------------------------------------------------------------------
    // 召唤物品材质与名称
    // -----------------------------------------------------------------------
    // 【换材质只改 SUMMON_ITEM_MATERIAL 这一行】改完记得把旧材质追加到
    // SUMMON_ITEM_LEGACY，这样已经发到玩家手里的旧召唤物仍然可用。
    //
    // 历史沿革：
    //   烈焰棒   BLAZE_ROD  —— 最初版本
    //   木棍     STICK      —— 生产交付版；右键容易被部分模组抢占，故弃用
    //   回响碎片 ECHO_SHARD —— 过渡版本
    //   绿宝石   EMERALD    —— 当前使用（需求指定：绿宝石，名字即怪物名）
    var SUMMON_ITEM_MATERIAL = Material.EMERALD;
    var SUMMON_ITEM_LEGACY = [Material.ECHO_SHARD, Material.STICK, Material.BLAZE_ROD];

    // 召唤物显示名 = BOSS 显示名本身，因此前缀留空。
    // （旧版本前缀为 ChatColor.GOLD + "召唤"，旧物品改名后依然靠 PDC 识别，不受影响。）
    var SUMMON_ITEM_NAME_PREFIX = ChatColor.GOLD + "";

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var pendingSummons = {};   // playerUuid -> pending 条目，见契约 6.6
    var pendingOrder = [];     // 保持插入顺序，便于稳定播报
    var stickCooldown = {};    // playerUuid -> 上次使用时的 globalTick
    var registry = null;

    // 注册表存储：一律使用 Java 容器，禁止保存跨引擎 JS 对象。
    // 必须使用 ConcurrentHashMap：OpenJS 1.5.0 用线程池并行加载脚本，
    // 主循环心跳与其它脚本的注册可能同时发生，普通 HashMap 会抛
    // java.util.ConcurrentModificationException（本机实测已复现）。
    var bossNames = new ConcurrentHashMap();        // id -> String
    var bossAliases = new ConcurrentHashMap();      // id -> java.util.List<String>
    var bossLore = new ConcurrentHashMap();         // id -> java.util.List<String>
    var bossSpawns = new ConcurrentHashMap();       // id -> BiFunction 适配器（Java 对象）
    var bossHeartbeats = new ConcurrentHashMap();   // id -> Double（毫秒时间戳）

    // ==== 兼容旧版 CallBoss 的扩展字段（仅对象形式注册会写入） ====
    // 旧生产脚本（InfernoFoehn 等）使用 stickName / stickLore / consumeOnSummon / silentSummon；
    // 这里保存这些字段，保证新框架替换旧 CallBoss 后旧 BOSS 的召唤物品与消耗行为不变。
    var bossStickNames = new ConcurrentHashMap();       // id -> String（自定义召唤物名称）
    var bossStickLores = new ConcurrentHashMap();       // id -> java.util.List<String>（完全替换默认 lore）
    var bossConsumeOnSummon = new ConcurrentHashMap();  // id -> Boolean.TRUE
    var bossSilentSummons = new ConcurrentHashMap();    // id -> Boolean.TRUE
    var bossLegacyFlags = new ConcurrentHashMap();      // id -> Boolean.TRUE（旧式注册，召唤物保留附魔光效）

    var syncDelayedTasks = [];   // 契约 6.5：主线程同步延迟队列

    var stickPdcKey = new NamespacedKey(plugin, "callboss_summon_boss_id");
    // 兼容旧版召唤烈焰棒 / 旧 PDC key；旧物品仍可右键召唤。
    var legacyStickPdcKey = new NamespacedKey(plugin, "call_boss_rod_boss_id");

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function nowMs() {
        return Date.now();
    }

    function scheduleSync(delayTicks, callback) {
        syncDelayedTasks.push({ at: globalTick + Math.max(0, delayTicks), fn: callback });
    }

    function processSyncDelayedTasks() {
        if (syncDelayedTasks.length === 0) return;
        var current = syncDelayedTasks;
        syncDelayedTasks = [];
        for (var i = 0; i < current.length; i++) {
            if (globalTick >= current[i].at) {
                try {
                    current[i].fn();
                } catch (e) {
                    log.error("CallBoss 延迟任务异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                }
            } else {
                syncDelayedTasks.push(current[i]);
            }
        }
    }

    function isAlive(id) {
        if (id == null) return false;
        var hb = bossHeartbeats.get(String(id));
        if (hb == null) return false;
        return (nowMs() - Number(hb)) < HEARTBEAT_TIMEOUT_MS;
    }

    function msg(sender, text) {
        if (sender == null) return;
        try {
            sender.sendMessage(text);
        } catch (e) {
            log.error("CallBoss 发送消息失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function toJavaStringList(source) {
        var out = new ArrayList();
        if (source == null) return out;
        try {
            if (typeof source.length === "number") {
                for (var i = 0; i < source.length; i++) out.add(String(source[i]));
            } else if (typeof source.size === "function" && typeof source.get === "function") {
                for (var j = 0; j < source.size(); j++) out.add(String(source.get(j)));
            }
        } catch (e) {
            log.warn("CallBoss 列表转换异常：" + e);
        }
        return out;
    }

    // 把跨引擎的 JS 函数立刻包成真正的 Java 适配器对象，
    // 之后只通过 Java 方法调用它，避免保存 JS 对象引用。
    function makeSpawnHandle(fn) {
        var Adapter = Java.extend(BiFunction, {
            apply: function (location, player) {
                var r = fn(location, player);
                return (r === true) ? true : (String(r) === "true");
            }
        });
        return new Adapter();
    }

    function isPassable(block) {
        try {
            var type = block.getType();
            if (type.isAir()) return true;
            return !type.isSolid();
        } catch (e) {
            return false;
        }
    }

    // 契约 5.2-1：右键位置向上检查 3 格净空
    function hasClearance(baseBlock) {
        for (var i = 0; i < SPAWN_CLEARANCE_HEIGHT; i++) {
            var b = baseBlock.getRelative(0, i, 0);
            if (!isPassable(b)) return false;
        }
        return true;
    }

    function blockCenterLocation(block) {
        return new Location(
            block.getWorld(),
            block.getX() + 0.5,
            block.getY(),
            block.getZ() + 0.5,
            0,
            0
        );
    }

    function isSummonItemMaterial(type) {
        if (type === SUMMON_ITEM_MATERIAL) return true;
        for (var i = 0; i < SUMMON_ITEM_LEGACY.length; i++) {
            if (type === SUMMON_ITEM_LEGACY[i]) return true;
        }
        return false;
    }

    function readBossIdFromStick(itemStack) {
        if (itemStack == null) return null;
        try {
            // 真正的判据是 PDC 里有没有 BOSS id；材质只做第一层过滤，
            // 并兼容历史上发放过的旧材质（见 SUMMON_ITEM_LEGACY）。
            if (!isSummonItemMaterial(itemStack.getType())) return null;
            var meta = itemStack.getItemMeta();
            if (meta == null) return null;
            var pdc = meta.getPersistentDataContainer();
            if (pdc == null) return null;
            var id = pdc.get(stickPdcKey, PersistentDataType.STRING);
            if (id != null) return id;
            // 兼容旧版 CallBoss 发出的召唤烈焰棒（旧 PDC key）。
            return pdc.get(legacyStickPdcKey, PersistentDataType.STRING);
        } catch (e) {
            log.error("CallBoss 读取召唤物 PDC 失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return null;
        }
    }

    function isMatchingSummonItem(itemStack, bossId) {
        if (itemStack == null) return false;
        if (!isSummonItemMaterial(itemStack.getType())) return false;
        var id = readBossIdFromStick(itemStack);
        return id != null && String(id) === String(bossId);
    }

    function consumeOneItem(inventory, slot, itemStack) {
        try {
            var amount = itemStack.getAmount();
            if (amount <= 1) {
                inventory.setItem(slot, null);
            } else {
                itemStack.setAmount(amount - 1);
                inventory.setItem(slot, itemStack);
            }
        } catch (e) { }
    }

    // 兼容旧版 consumeOnSummon：召唤成功后消耗一个对应召唤物。
    function consumeSummonItem(player, bossId) {
        try {
            if (player == null || !player.isOnline()) return false;
            var inv = player.getInventory();
            var main = inv.getItemInMainHand();
            if (isMatchingSummonItem(main, bossId)) {
                consumeOneItem(inv, inv.getHeldItemSlot(), main);
                return true;
            }
            var off = inv.getItemInOffHand();
            if (isMatchingSummonItem(off, bossId)) {
                consumeOneItem(inv, 40, off);
                return true;
            }
            var contents = inv.getContents();
            for (var i = 0; i < contents.length; i++) {
                if (!isMatchingSummonItem(contents[i], bossId)) continue;
                consumeOneItem(inv, i, contents[i]);
                return true;
            }
        } catch (e) {
            log.warn("CallBoss 消耗召唤物失败：" + e);
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // 召唤物（绿宝石）
    // -----------------------------------------------------------------------
    function createStick(bossId, bossName, loreList) {
        var key = String(bossId);
        var stack = new ItemStack(SUMMON_ITEM_MATERIAL, 1);
        var meta = stack.getItemMeta();
        var plainName = bossName == null ? key : String(bossName);

        var legacyName = bossStickNames.get(key);
        if (legacyName != null && String(legacyName).length > 0) {
            // 兼容旧版 stickName（例如困难模式 [炎狱焚风-困难模式]）。
            meta.setDisplayName(String(legacyName));
        } else {
            // 需求：绿宝石的名字就是召唤怪物的名称本身。
            meta.setDisplayName(SUMMON_ITEM_NAME_PREFIX + ChatColor.stripColor(plainName));
        }

        var lore = new ArrayList();
        var legacyLore = bossStickLores.get(key);
        if (legacyLore != null) {
            // 兼容旧版 stickLore：提供时完全替换默认 lore（空列表 = 无 lore）。
            for (var s = 0; s < legacyLore.size(); s++) {
                lore.add(String(legacyLore.get(s)));
            }
        } else {
            lore.add(ChatColor.GRAY + "BOSS id：" + ChatColor.WHITE + key);
            lore.add(ChatColor.GRAY + "右键地面开始 " + SUMMON_COUNTDOWN_SECONDS + " 秒召唤倒计时");
            lore.add(ChatColor.DARK_GRAY + "倒计时结束前请离开生成点");
            if (loreList != null) {
                for (var i = 0; i < loreList.size(); i++) {
                    lore.add(ChatColor.GRAY + String(loreList.get(i)));
                }
            }
        }
        meta.setLore(lore);

        if (bossLegacyFlags.get(key) != null) {
            // 旧版召唤物带附魔光效；新式召唤绿宝石保持干净外观。
            meta.addEnchant(Enchantment.UNBREAKING, 1, true);
            meta.addItemFlags(ItemFlag.HIDE_ENCHANTS, ItemFlag.HIDE_ATTRIBUTES);
        } else {
            meta.addItemFlags(ItemFlag.HIDE_ATTRIBUTES);
        }

        var pdc = meta.getPersistentDataContainer();
        pdc.set(stickPdcKey, PersistentDataType.STRING, key);
        // 同时写旧 key，便于旧脚本 / 旧物品逻辑读取。
        try { pdc.set(legacyStickPdcKey, PersistentDataType.STRING, key); } catch (e) { }
        stack.setItemMeta(meta);
        return stack;
    }

    // -----------------------------------------------------------------------
    // BossRegistry 共享 API
    // -----------------------------------------------------------------------
    function buildRegistry() {
        var api = {};

        api.version = REGISTRY_VERSION;

        api.register = function (defOrId, name, aliases, lore, spawnFn) {
            var id = null;
            var defName = null;
            var defAliases = null;
            var defLore = null;
            var fn = null;
            var defStickName = null;
            var defStickLore = null;
            var defConsumeOnSummon = false;
            var defSilentSummon = false;
            var defLegacy = false;

            if (typeof defOrId === "string") {
                id = defOrId;
                defName = name;
                defAliases = aliases;
                defLore = lore;
                fn = spawnFn;
            } else if (defOrId != null) {
                id = defOrId.id;
                defName = defOrId.name;
                defAliases = defOrId.aliases;
                defLore = defOrId.lore;
                fn = defOrId.spawn;
                // 兼容旧版对象式注册的扩展字段；仅做立即快照，避免跨引擎持有 JS 对象。
                try {
                    if (defOrId.stickName != null && String(defOrId.stickName).length > 0) {
                        defStickName = String(defOrId.stickName);
                        defLegacy = true;
                    }
                    if (defOrId.stickLore !== undefined && defOrId.stickLore !== null) {
                        defStickLore = toJavaStringList(defOrId.stickLore);
                        defLegacy = true;
                    }
                    if (defOrId.consumeOnSummon === true) {
                        defConsumeOnSummon = true;
                        defLegacy = true;
                    }
                    if (defOrId.silentSummon === true) {
                        defSilentSummon = true;
                        defLegacy = true;
                    }
                } catch (e) {
                    log.warn("CallBoss 读取旧版注册字段失败（忽略）：" + e);
                }
            }

            if (id == null || typeof fn !== "function") {
                log.error("CallBoss 注册失败：缺少 id 或 spawn 函数。");
                return false;
            }

            var key = String(id);
            // 立刻把跨引擎数据快照成 Java 值，之后不再持有 JS 对象引用。
            bossNames.put(key, defName == null ? key : String(defName));
            bossAliases.put(key, toJavaStringList(defAliases));
            bossLore.put(key, toJavaStringList(defLore));
            bossSpawns.put(key, makeSpawnHandle(fn));
            bossHeartbeats.put(key, nowMs());

            // 重新注册时先清掉旧版扩展字段，避免残留。
            bossStickNames.remove(key);
            bossStickLores.remove(key);
            bossConsumeOnSummon.remove(key);
            bossSilentSummons.remove(key);
            bossLegacyFlags.remove(key);
            if (defStickName != null) bossStickNames.put(key, defStickName);
            if (defStickLore != null) bossStickLores.put(key, defStickLore);
            if (defConsumeOnSummon) bossConsumeOnSummon.put(key, true);
            if (defSilentSummon) bossSilentSummons.put(key, true);
            if (defLegacy) bossLegacyFlags.put(key, true);

            log.info("CallBoss 已注册 BOSS：" + key + "（" + bossNames.get(key) + "）");
            return true;
        };

        api.unregister = function (idOrDef) {
            if (idOrDef == null) return false;
            var key = (typeof idOrDef === "string") ? String(idOrDef) : String(idOrDef.id);
            if (bossSpawns.get(key) == null) return false;
            bossNames.remove(key);
            bossAliases.remove(key);
            bossLore.remove(key);
            bossSpawns.remove(key);
            bossHeartbeats.remove(key);
            bossStickNames.remove(key);
            bossStickLores.remove(key);
            bossConsumeOnSummon.remove(key);
            bossSilentSummons.remove(key);
            bossLegacyFlags.remove(key);
            log.info("CallBoss 已注销 BOSS：" + key);
            return true;
        };

        api.heartbeat = function (id) {
            if (id == null) return false;
            var key = String(id);
            if (bossSpawns.get(key) == null) return false;
            bossHeartbeats.put(key, nowMs());
            return true;
        };

        api.has = function (id) {
            if (id == null) return false;
            return bossSpawns.get(String(id)) != null && isAlive(String(id));
        };

        // 兼容生产脚本的原始写法：`if (api !== lastApi || !api.get(BOSS_ID))`。
        // 返回值刻意用 java.util.Map（真正的 Java 对象）而不是 JS 对象——
        // 跨引擎的 JS 对象属性读不可靠（见文件头说明）。
        // 调用方通常只做真值判断；需要取字段请用 map.get("name")。
        api.get = function (id) {
            if (id == null) return null;
            var key = String(id);
            if (bossSpawns.get(key) == null) return null;
            if (!isAlive(key)) return null;
            var info = new LinkedHashMap();
            info.put("id", key);
            info.put("name", api.getName(key));
            info.put("alive", true);
            return info;
        };

        api.list = function () {
            var out = [];
            var it = bossSpawns.keySet().iterator();
            while (it.hasNext()) {
                var id = String(it.next());
                if (isAlive(id)) out.push(id);
            }
            return out;
        };

        api.debug = function () {
            var out = new ArrayList();
            out.add("registryIdentity=" + String(registry == null ? "null" : "set"));
            out.add("registeredCount=" + bossSpawns.size());
            out.add("heartbeatCount=" + bossHeartbeats.size());
            out.add("nameCount=" + bossNames.size());
            var it = bossSpawns.keySet().iterator();
            while (it.hasNext()) {
                var id = String(it.next());
                out.add("key=" + id + " alive=" + isAlive(id) + " name=" + String(bossNames.get(id)));
            }
            return out;
        };

        api.getName = function (id) {
            var v = bossNames.get(String(id));
            return v == null ? String(id) : String(v);
        };

        api.getAliases = function (id) {
            var v = bossAliases.get(String(id));
            return v == null ? [] : v;
        };

        api.describe = function (id) {
            var key = String(id);
            var out = new ArrayList();
            out.add("id=" + key);
            out.add("name=" + api.getName(key));
            var al = bossAliases.get(key);
            var aliasText = "";
            if (al != null) {
                for (var i = 0; i < al.size(); i++) {
                    aliasText += (i === 0 ? "" : ",") + al.get(i);
                }
            }
            out.add("aliases=" + aliasText);
            out.add("alive=" + isAlive(key));
            out.add("registered=" + (bossSpawns.get(key) != null));
            var hb = bossHeartbeats.get(key);
            out.add("heartbeatAgeMs=" + (hb == null ? "-1" : String(Math.round(nowMs() - Number(hb)))));
            return out;
        };

        api.resolve = function (query) {
            if (query == null) return null;
            var q = String(query).trim();
            if (q.length === 0) return null;
            var lower = q.toLowerCase();
            var ids = api.list();
            var i;
            var j;

            // 1) id / 显示名精确匹配（大小写不敏感）
            for (i = 0; i < ids.length; i++) {
                if (ids[i].toLowerCase() === lower) return ids[i];
                if (String(api.getName(ids[i])).toLowerCase() === lower) return ids[i];
            }
            // 2) 别名精确匹配
            for (i = 0; i < ids.length; i++) {
                var al = bossAliases.get(ids[i]);
                if (al == null) continue;
                for (j = 0; j < al.size(); j++) {
                    if (String(al.get(j)).toLowerCase() === lower) return ids[i];
                }
            }

            // 3) 唯一前缀匹配：兼容旧版 CallBoss 的“/call boss 炎狱”这类用法，
            //    同时覆盖 id、显示名与别名。
            var matched = null;
            var matchedCount = 0;
            for (i = 0; i < ids.length; i++) {
                var id = String(ids[i]);
                var name = String(api.getName(id));
                var hit = id.toLowerCase().indexOf(lower) === 0
                        || name.toLowerCase().indexOf(lower) === 0;
                if (!hit) {
                    var aliases = bossAliases.get(id);
                    if (aliases != null) {
                        for (j = 0; j < aliases.size(); j++) {
                            if (String(aliases.get(j)).toLowerCase().indexOf(lower) === 0) {
                                hit = true;
                                break;
                            }
                        }
                    }
                }
                if (hit) {
                    if (matched === null) {
                        matched = id;
                        matchedCount = 1;
                    } else if (matched !== id) {
                        matchedCount++;
                    }
                }
            }
            return matchedCount === 1 ? matched : null;
        };

        api.createStick = function (idOrDef) {
            var key = (idOrDef != null && typeof idOrDef === "object")
                ? String(idOrDef.id) : String(idOrDef);
            if (bossSpawns.get(key) == null) return null;
            return createStick(key, api.getName(key), bossLore.get(key));
        };

        api.spawn = function (id, location, player) {
            var key = String(id);
            var handle = bossSpawns.get(key);
            if (handle == null) {
                log.error("CallBoss 召唤失败：BOSS " + key + " 未注册。");
                return false;
            }
            if (!isAlive(key)) {
                log.error("CallBoss 召唤失败：BOSS " + key + " 心跳失效（脚本可能未加载）。");
                return false;
            }
            try {
                var r = handle.apply(location, player);
                return (r === true) || (String(r) === "true");
            } catch (e) {
                log.error("CallBoss 调用 " + key + " 的 spawn 异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                return false;
            }
        };

        return api;
    }

    function ensureRegistryShared() {
        var existing = getShared(REGISTRY_NAME);
        if (registry == null) registry = buildRegistry();
        if (existing == null || existing.version !== REGISTRY_VERSION || existing !== registry) {
            setShared(REGISTRY_NAME, registry);
        }
        return registry;
    }

    // -----------------------------------------------------------------------
    // 倒计时与召唤
    // -----------------------------------------------------------------------
    function announce(sender, text) {
        msg(sender, text);
        try {
            if (sender != null && sender instanceof PlayerClass) {
                sender.sendActionBar(text);
            }
        } catch (ignored) {
            // 提示类失败允许静默
        }
    }

    function secondsLeft(pending) {
        var left = pending.readyTick - globalTick;
        if (left < 0) left = 0;
        return Math.ceil(left / 20);
    }

    function startCountdown(player, bossId, bossName, location) {
        var uuid = String(player.getUniqueId().toString());

        if (pendingSummons[uuid] != null) {
            msg(player, ChatColor.RED + "[召唤] 你已经在倒计时中了，请等待本次结束。");
            return false;
        }

        var pending = {
            player: player,
            playerUuid: uuid,
            bossId: String(bossId),
            bossName: String(bossName),
            silent: bossSilentSummons.get(String(bossId)) != null,
            location: location,
            worldName: String(location.getWorld().getName()),
            readyTick: globalTick + SUMMON_COUNTDOWN_TICKS,
            nextAnnounceTick: globalTick + SUMMON_ANNOUNCE_INTERVAL_TICKS
        };

        pendingSummons[uuid] = pending;
        pendingOrder.push(uuid);

        if (!pending.silent) {
            try {
                player.sendTitle(
                    ChatColor.GOLD + pending.bossName,
                    ChatColor.YELLOW + "即将降临，请撤离",
                    5, 40, 10
                );
            } catch (ignored) {
                // 旧版 API 不可用时静默
            }
            announce(player, ChatColor.GOLD + "[召唤] " + ChatColor.WHITE + pending.bossName
                + ChatColor.GOLD + " 将在 " + SUMMON_COUNTDOWN_SECONDS + " 秒后降临于此。");
        }
        log.info("CallBoss 开始倒计时：player=" + player.getName() + " boss=" + pending.bossId
            + " world=" + pending.worldName + " readyTick=" + pending.readyTick);
        return true;
    }

    function cancelCountdown(uuid, reason) {
        var pending = pendingSummons[uuid];
        if (pending == null) return;
        delete pendingSummons[uuid];
        var idx = pendingOrder.indexOf(uuid);
        if (idx >= 0) pendingOrder.splice(idx, 1);
        if (reason != null) {
            msg(pending.player, ChatColor.RED + "[召唤] " + reason);
        }
        log.info("CallBoss 取消倒计时：" + uuid + " 原因：" + reason);
    }

    function executePendingSummon(pending) {
        var uuid = pending.playerUuid;
        delete pendingSummons[uuid];
        var idx = pendingOrder.indexOf(uuid);
        if (idx >= 0) pendingOrder.splice(idx, 1);

        var player = Bukkit.getPlayer(UUIDClass.fromString(uuid));
        if (player == null || !player.isOnline()) {
            log.info("CallBoss 倒计时结束但玩家已离线：" + uuid);
            return;
        }
        if (String(player.getWorld().getName()) !== pending.worldName) {
            msg(player, ChatColor.RED + "[召唤] 你已离开召唤所在世界，本次召唤取消。");
            log.info("CallBoss 倒计时结束但玩家换世界：" + uuid);
            return;
        }

        var api = ensureRegistryShared();
        if (!api.has(pending.bossId)) {
            msg(player, ChatColor.RED + "[召唤] BOSS " + pending.bossId + " 当前不可用（脚本未加载或已失效）。");
            log.error("CallBoss 召唤失败：BOSS " + pending.bossId + " 未注册或心跳失效。");
            return;
        }

        var ok = api.spawn(pending.bossId, pending.location, player);

        if (ok) {
            // 兼容旧版 consumeOnSummon：召唤成功后消耗一个对应召唤物。
            if (bossConsumeOnSummon.get(String(pending.bossId)) != null) {
                consumeSummonItem(player, pending.bossId);
            }
            if (!pending.silent) {
                msg(player, ChatColor.GOLD + "[召唤] " + ChatColor.WHITE + pending.bossName
                    + ChatColor.GOLD + " 已降临。");
            }
            log.info("CallBoss 召唤成功：" + pending.bossId + " @ " + pending.worldName);
        } else {
            msg(player, ChatColor.RED + "[召唤] " + pending.bossName + " 降生失败，请检查生成点周围空间与脚本日志。");
            log.error("CallBoss 召唤失败：" + pending.bossId + " spawn 返回 false。");
        }
    }

    function processPendingSummons() {
        if (pendingOrder.length === 0) return;
        var snapshot = pendingOrder.slice(0);
        for (var i = 0; i < snapshot.length; i++) {
            var pending = pendingSummons[snapshot[i]];
            if (pending == null) continue;

            if (pending.player == null || !pending.player.isOnline()) {
                cancelCountdown(pending.playerUuid, null);
                continue;
            }
            if (globalTick >= pending.readyTick) {
                try {
                    executePendingSummon(pending);
                } catch (e) {
                    log.error("CallBoss 处理倒计时异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                    delete pendingSummons[pending.playerUuid];
                }
            } else if (globalTick >= pending.nextAnnounceTick) {
                pending.nextAnnounceTick = globalTick + SUMMON_ANNOUNCE_INTERVAL_TICKS;
                if (!pending.silent) {
                    announce(pending.player, ChatColor.YELLOW + "[召唤] " + secondsLeft(pending) + " ...");
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 事件注册
    // 注意：这里不直接在顶层调用 registerEvent / addCommand，而是统一放进
    // registerAll()，由主线程第一个 tick 执行。原因：OpenJS 1.5.0 用线程池
    // 并行加载脚本，而它内部的 eventListenersMap 与命令表都是普通 HashMap，
    // 多个脚本同时注册会抛 java.util.ConcurrentModificationException（本机实测）。
    // -----------------------------------------------------------------------
    function registerAll() {

    registerEvent("org.bukkit.event.player.PlayerInteractEvent", function (event) {
        try {
            var actionName = String(event.getAction().name());
            if (actionName !== "RIGHT_CLICK_BLOCK") return;
            if (event.getHand() == null || String(event.getHand().name()) !== "HAND") return;

            var player = event.getPlayer();
            if (player == null) return;

            var bossId = readBossIdFromStick(event.getItem());
            if (bossId == null) return;

            var clicked = event.getClickedBlock();
            if (clicked == null) return;

            // 阻止召唤物与原版方块交互（防止模组/原版抢占右键逻辑）
            try {
                event.setUseInteractedBlock(EventResult.DENY);
                event.setUseItemInHand(EventResult.DENY);
            } catch (ignored) {
                // 某些服务端实现不支持，忽略
            }

            var uuid = String(player.getUniqueId().toString());
            var last = stickCooldown[uuid];
            if (last != null && globalTick - last < STICK_USE_COOLDOWN_TICKS) return;

            var api = ensureRegistryShared();
            if (!api.has(bossId)) {
                msg(player, ChatColor.RED + "[召唤] BOSS " + bossId + " 当前未注册（脚本未加载或心跳失效）。");
                return;
            }

            var baseBlock = clicked.getRelative(event.getBlockFace());
            if (!hasClearance(baseBlock)) {
                msg(player, ChatColor.RED + "[召唤] 生成点上方需要至少 " + SPAWN_CLEARANCE_HEIGHT + " 格净空。");
                return;
            }

            stickCooldown[uuid] = globalTick;
            startCountdown(player, String(bossId), api.getName(bossId), blockCenterLocation(baseBlock));
        } catch (e) {
            log.error("CallBoss 召唤绿宝石事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 指令注册
    // -----------------------------------------------------------------------
    function listBosses(sender) {
        var api = ensureRegistryShared();
        var ids = api.list();
        msg(sender, ChatColor.GOLD + "===== 可用 BOSS（" + ids.length + "）=====");
        if (ids.length === 0) {
            msg(sender, ChatColor.GRAY + "（暂无。请确认 BOSS 脚本已 /oj reload 且心跳正常）");
            return;
        }
        for (var i = 0; i < ids.length; i++) {
            var aliases = api.getAliases(ids[i]);
            var line = ChatColor.YELLOW + " - " + ChatColor.WHITE + api.getName(ids[i])
                + ChatColor.GRAY + " (id=" + ids[i] + ")";
            if (aliases != null && aliases.size() > 0) {
                var aliasText = "";
                for (var j = 0; j < aliases.size(); j++) {
                    aliasText += (j === 0 ? "" : "/") + aliases.get(j);
                }
                line += ChatColor.DARK_GRAY + " 别名：" + aliasText;
            }
            msg(sender, line);
        }
        msg(sender, ChatColor.GRAY + "用法：" + ChatColor.WHITE + "/call boss <显示名>");
    }

    function giveStick(sender, query) {
        if (!(sender instanceof PlayerClass)) {
            msg(sender, ChatColor.RED + "控制台无法获取召唤绿宝石，请在游戏内执行。");
            return;
        }
        var api = ensureRegistryShared();
        var id = api.resolve(query);
        if (id == null) {
            msg(sender, ChatColor.RED + "[召唤] 找不到 BOSS：" + query + ChatColor.GRAY + "（用 /call boss 查看列表）");
            return;
        }
        var stick = api.createStick(id);
        if (stick == null) {
            msg(sender, ChatColor.RED + "[召唤] 生成召唤绿宝石失败：" + id);
            return;
        }
        var leftover = sender.getInventory().addItem(stick);
        if (leftover != null && !leftover.isEmpty()) {
            sender.getWorld().dropItemNaturally(sender.getLocation(), stick);
            msg(sender, ChatColor.YELLOW + "[召唤] 背包已满，召唤绿宝石已掉落在脚下。");
        }
        if (bossSilentSummons.get(String(id)) == null) {
            msg(sender, ChatColor.GOLD + "[召唤] 已获得 " + ChatColor.WHITE + api.getName(id)
                + ChatColor.GOLD + " 的召唤绿宝石，右键地面开始 "
                + SUMMON_COUNTDOWN_SECONDS + " 秒倒计时。");
        }
    }

    var callCommand = {
        onCommand: function (sender, args) {
            try {
                if (args == null || args.length === 0) {
                    msg(sender, ChatColor.GOLD + "用法：" + ChatColor.WHITE + "/call boss [显示名]");
                    listBosses(sender);
                    return true;
                }
                var sub = String(args[0]).toLowerCase();
                if (sub !== "boss") {
                    msg(sender, ChatColor.RED + "未知子命令：" + args[0] + ChatColor.GRAY + "（本框架只提供 /call boss）");
                    return true;
                }
                if (args.length === 1) {
                    listBosses(sender);
                    return true;
                }
                var nameParts = [];
                for (var i = 1; i < args.length; i++) nameParts.push(String(args[i]));
                giveStick(sender, nameParts.join(" "));
                return true;
            } catch (e) {
                log.error("CallBoss 指令异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                msg(sender, ChatColor.RED + "指令执行出错，请查看服务端日志。");
                return true;
            }
        },
        // 实测（2026-09-29）：OpenJS 的 InternalSystems$1.tabComplete 会把本函数的
        // 返回值强转成 java.util.List，返回 JS 数组会抛
        //   ClassCastException: ScriptObjectMirror cannot be cast to java.util.List
        // 本机实测：toJavaList([...]) 返回 ListAdapter（instanceof java.util.List == true），
        // 是可用的；但这里改用显式 new ArrayList()，语义最明确、不受 toJavaList 实现影响。
        onTabComplete: function (sender, args) {
            var out = new ArrayList();
            try {
                if (args == null) return out;
                if (args.length <= 1) {
                    out.add("boss");
                    return out;
                }
                if (String(args[0]).toLowerCase() !== "boss") return out;
                var api = ensureRegistryShared();
                var ids = api.list();
                var partial = String(args[args.length - 1]).toLowerCase();
                for (var i = 0; i < ids.length; i++) {
                    var name = api.getName(ids[i]);
                    var matched = name.toLowerCase().indexOf(partial) === 0
                        || ids[i].toLowerCase().indexOf(partial) === 0;
                    if (!matched) {
                        var aliases = api.getAliases(ids[i]);
                        for (var j = 0; j < aliases.size(); j++) {
                            if (String(aliases.get(j)).toLowerCase().indexOf(partial) === 0) {
                                matched = true;
                                break;
                            }
                        }
                    }
                    if (matched) out.add(name);
                }
                return out;
            } catch (e) {
                return new ArrayList();
            }
        }
    };

    addCommand("call", callCommand, "");

    }   // ---- end registerAll ----

    // -----------------------------------------------------------------------
    // 主循环
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            processSyncDelayedTasks();
            processPendingSummons();
            ensureRegistryShared();
        } catch (e) {
            log.error("CallBoss tick 异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 心跳
    // -----------------------------------------------------------------------
    task.repeat(ticks(HEARTBEAT_INTERVAL_TICKS), ticks(HEARTBEAT_INTERVAL_TICKS), function () {
        try {
            ensureRegistryShared();
        } catch (e) {
            log.error("CallBoss 心跳异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 启动
    // -----------------------------------------------------------------------
    ensureRegistryShared();
    scheduleSync(1, registerAll);
    log.info("CallBoss 已加载：使用 /call boss 获取召唤绿宝石，右键地面 " + SUMMON_COUNTDOWN_SECONDS + " 秒倒计时后召唤。");
})();
