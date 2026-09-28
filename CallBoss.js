/*
 * CallBoss.js —— 通用自定义 BOSS 召唤框架（OpenJS 1.5.0）
 *
 * 统一指令格式（后续所有自定义怪物都遵守此格式）：
 *     /call boss <怪物名字>
 *
 * 效果：
 *     给予玩家一根名为“召唤<怪物名字>”的烈焰棒，右键点击地面后进入 6 秒倒计时，
 *     倒计时结束才真正召唤对应 BOSS，给玩家时间撤离至安全距离。
 *     烈焰棒上带有 BOSS 简介；通过 PDC 记录 BOSS id，不会和普通烈焰棒冲突。
 *
 * 后续新增 BOSS 的方式：
 *     新建一个 .js 脚本，调用 getShared("BossRegistry").register({...}) 注册即可。
 *     register 需要提供：
 *         id          —— 英文唯一 id（例如 inferno_foehn）
 *         name        —— 显示名（例如 炎狱焚风）
 *         aliases     —— 可选，指令可用的别名数组
 *         lore        —— 可选，烈焰棒简介的额外行（字符串数组）
 *         heartbeat   —— 由注册的 BOSS 脚本定期更新，用来判断脚本是否还在运行
 *         spawn(location, player) —— 真正生成 BOSS 的函数，返回 true / false
 *
 * 说明：本框架只负责“指令 -> 召唤烈焰棒 -> 右键倒计时 -> 生成 BOSS”这条通用链路，
 *       BOSS 的具体 AI、血量、技能全部由各自的 BOSS 脚本实现。
 */

// CallBoss IIFE 包装
// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见仓库根目录《OpenJS脚本数据契约.md》。
(function () {
    "use strict";

    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var Enchantment = Java.type("org.bukkit.enchantments.Enchantment");
    var ItemFlag = Java.type("org.bukkit.inventory.ItemFlag");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Player = Java.type("org.bukkit.entity.Player");
    var Action = Java.type("org.bukkit.event.block.Action");
    var EquipmentSlot = Java.type("org.bukkit.inventory.EquipmentSlot");

    var CALL_ITEM_KEY = new NamespacedKey(plugin, "call_boss_rod_boss_id");

    // ---------------------------------------------------------------------------
    // 注册表
    // ---------------------------------------------------------------------------

    var definitions = {};   // id -> definition
    var lookup = {};        // 归一化名称 -> definition
    var summonCooldown = {};// player uuid -> 上次右键时间

    var HEARTBEAT_TIMEOUT_MS = 10000;
    var SUMMON_COOLDOWN_MS = 1200;
    var SUMMON_COUNTDOWN_SECONDS = 6;
    var SUMMON_COUNTDOWN_TICKS = SUMMON_COUNTDOWN_SECONDS * 20;

    var pendingSummons = [];       // 等待倒计时结束的召唤
    var pendingSummonPlayers = {}; // player uuid -> true，避免同一玩家重复排队
    var callBossTick = 0;

    function normalizeName(value) {
        return String(value == null ? "" : value).trim().toLowerCase();
    }

    function isAliveDefinition(def) {
        if (!def) return false;
        if (typeof def.heartbeat === "number" && def.heartbeat > 0) {
            return (Date.now() - def.heartbeat) <= HEARTBEAT_TIMEOUT_MS;
        }
        return true;
    }

    function rebuildLookup() {
        lookup = {};
        for (var id in definitions) {
            if (!definitions.hasOwnProperty(id)) continue;
            var def = definitions[id];
            if (!def) continue;
            lookup[normalizeName(id)] = def;
            lookup[normalizeName(def.name)] = def;
            var aliases = def.aliases;
            if (aliases) {
                for (var i = 0; i < aliases.length; i++) {
                    lookup[normalizeName(aliases[i])] = def;
                }
            }
        }
    }

    function registerBoss(def) {
        if (!def || !def.id || !def.name || typeof def.spawn !== "function") {
            log.warn("CallBoss.register 参数不完整，已忽略。");
            return false;
        }
        def.id = String(def.id);
        def.name = String(def.name);
        if (!def.aliases) def.aliases = [];
        def.heartbeat = Date.now();

        if (definitions[def.id]) {
            log.info("CallBoss 重新注册 BOSS：" + def.name + " (" + def.id + ")");
        } else {
            log.info("CallBoss 注册 BOSS：" + def.name + " (" + def.id + ")");
        }
        definitions[def.id] = def;
        rebuildLookup();
        return true;
    }

    function unregisterBoss(idOrDef) {
        var id = idOrDef;
        if (idOrDef && typeof idOrDef === "object" && idOrDef.id) id = idOrDef.id;
        id = String(id);
        if (definitions[id]) {
            delete definitions[id];
            rebuildLookup();
        }
    }

    function heartbeatBoss(id) {
        var def = definitions[String(id)];
        if (def) def.heartbeat = Date.now();
    }

    function findBoss(id) {
        var def = definitions[String(id == null ? "" : id)];
        if (def && isAliveDefinition(def)) return def;
        return null;
    }

    function resolveBoss(query) {
        var q = normalizeName(query);
        if (!q) return null;

        var exact = lookup[q];
        if (exact && isAliveDefinition(exact)) return exact;
        if (exact) {
            // 对应 BOSS 脚本已经不在运行，清掉过期注册。
            unregisterBoss(exact.id);
        }

        // 支持唯一前缀匹配，例如 /call boss 炎狱
        var matches = [];
        for (var id in definitions) {
            if (!definitions.hasOwnProperty(id)) continue;
            var def = definitions[id];
            if (!isAliveDefinition(def)) continue;
            var keys = [id, def.name].concat(def.aliases || []);
            for (var i = 0; i < keys.length; i++) {
                if (normalizeName(keys[i]).indexOf(q) === 0 && matches.indexOf(def) === -1) {
                    matches.push(def);
                    break;
                }
            }
        }
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return { ambiguous: matches };
        return null;
    }

    function listAliveBosses() {
        var result = [];
        for (var id in definitions) {
            if (!definitions.hasOwnProperty(id)) continue;
            var def = definitions[id];
            if (isAliveDefinition(def)) result.push(def);
        }
        return result;
    }

    // ---------------------------------------------------------------------------
    // 召唤烈焰棒
    // ---------------------------------------------------------------------------

    function createSummonStick(def) {
        var item = new ItemStack(Material.BLAZE_ROD, 1);
        var meta = item.getItemMeta();
        if (!meta) return item;

        if (def.stickName) {
            meta.setDisplayName(def.stickName);
        } else {
            meta.setDisplayName(ChatColor.GOLD + "召唤" + ChatColor.RED + def.name);
        }

        var lore = [];
        if (def.stickLore !== undefined && def.stickLore !== null) {
            for (var s = 0; s < def.stickLore.length; s++) lore.push(def.stickLore[s]);
        } else {
            lore.push(ChatColor.GRAY + "右键点击地面，6 秒后召唤 " + ChatColor.RED + def.name);
            lore.push(ChatColor.RED + "倒计时期间请迅速撤离至安全距离！");
            lore.push(ChatColor.DARK_GRAY + "————————————————");
            if (def.lore) {
                for (var i = 0; i < def.lore.length; i++) {
                    lore.push(def.lore[i]);
                }
                lore.push(ChatColor.DARK_GRAY + "————————————————");
            }
            lore.push(ChatColor.DARK_GRAY + "指令：" + ChatColor.GRAY + "/call boss " + def.name);
        }
        meta.setLore(toJavaList(lore));

        // 只保留附魔光效，隐藏附魔和属性文字。
        meta.addEnchant(Enchantment.UNBREAKING, 1, true);
        meta.addItemFlags(ItemFlag.HIDE_ENCHANTS, ItemFlag.HIDE_ATTRIBUTES);

        meta.getPersistentDataContainer().set(CALL_ITEM_KEY, PersistentDataType.STRING, def.id);
        item.setItemMeta(meta);
        return item;
    }

    function isSummonStick(item) {
        if (item == null || item.getType() != Material.BLAZE_ROD || !item.hasItemMeta()) return false;
        var meta = item.getItemMeta();
        if (!meta) return false;
        return meta.getPersistentDataContainer().has(CALL_ITEM_KEY, PersistentDataType.STRING);
    }

    function getStickBossId(item) {
        try {
            return item.getItemMeta().getPersistentDataContainer().get(CALL_ITEM_KEY, PersistentDataType.STRING);
        } catch (e) {
            return null;
        }
    }

    function findSafeSpawnLocation(location) {
        var base = location.clone();
        for (var dy = 0; dy < 6; dy++) {
            var test = base.clone().add(0, dy, 0);
            var block = test.getBlock();
            if (block.isEmpty()
                    && block.getRelative(0, 1, 0).isEmpty()
                    && block.getRelative(0, 2, 0).isEmpty()) {
                return test;
            }
        }
        return base;
    }

    function giveSummonStick(player, def) {
        var item = createSummonStick(def);
        var leftover = player.getInventory().addItem(item);
        if (leftover && !leftover.isEmpty()) {
            player.getWorld().dropItemNaturally(player.getLocation(), item);
            player.sendMessage(ChatColor.YELLOW + "背包已满，召唤烈焰棒已掉落在你脚下。");
        }
    }

    // ---------------------------------------------------------------------------
    // 6 秒召唤倒计时
    // ---------------------------------------------------------------------------

    function announceSummonCountdown(pending, seconds) {
        if (pending.silent === true) return;
        var player = pending.player;
        if (!player || !player.isOnline()) return;
        try {
            player.sendTitle(ChatColor.GOLD + "召唤倒计时",
                    ChatColor.RED + String(seconds) + ChatColor.GRAY + " 秒后 "
                            + ChatColor.DARK_RED + pending.bossName + ChatColor.GRAY + " 将降临！",
                    0, 25, 5);
            player.sendMessage(ChatColor.GOLD + "[召唤] " + ChatColor.YELLOW + "请在 "
                    + ChatColor.RED + seconds + ChatColor.YELLOW + " 秒内撤离至安全距离！"
                    + ChatColor.GRAY + "（召唤：" + pending.bossName + "）");
            player.sendActionBar(ChatColor.RED + "召唤倒计时 " + seconds + " 秒：请迅速撤离！");
        } catch (e) { }
    }

    function removeSummonStick(player, bossId) {
        try {
            if (!player || !player.isOnline()) return;
            var inv = player.getInventory();
            var main = inv.getItemInMainHand();
            if (main != null && isSummonStick(main)
                    && String(getStickBossId(main)) === String(bossId)) {
                var amount = main.getAmount();
                if (amount <= 1) inv.setItemInMainHand(null);
                else { main.setAmount(amount - 1); inv.setItemInMainHand(main); }
                return;
            }
            var off = inv.getItemInOffHand();
            if (off != null && isSummonStick(off)
                    && String(getStickBossId(off)) === String(bossId)) {
                var amount2 = off.getAmount();
                if (amount2 <= 1) inv.setItemInOffHand(null);
                else { off.setAmount(amount2 - 1); inv.setItemInOffHand(off); }
                return;
            }
            var contents = inv.getContents();
            for (var i = 0; i < contents.length; i++) {
                var item = contents[i];
                if (item == null || !isSummonStick(item)) continue;
                if (String(getStickBossId(item)) !== String(bossId)) continue;
                if (item.getAmount() <= 1) inv.setItem(i, null);
                else item.setAmount(item.getAmount() - 1);
                return;
            }
        } catch (e) { }
    }

    function executePendingSummon(pending) {
        var player = pending.player;
        if (!player || !player.isOnline()) return;

        var def = findBoss(pending.bossId);
        if (!def) {
            player.sendMessage(ChatColor.RED + "召唤失败：BOSS 脚本已卸载或尚未加载。");
            return;
        }

        if (pending.worldName !== null
                && String(player.getWorld().getName()) !== pending.worldName) {
            player.sendMessage(ChatColor.RED + "你已经离开召唤地点，本次召唤已取消。");
            return;
        }

        var spawned = false;
        try {
            spawned = def.spawn(pending.location, player);
        } catch (e) {
            log.error("CallBoss 调用 BOSS[" + def.name + "] 的 spawn 失败：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
            player.sendMessage(ChatColor.RED + "召唤失败：BOSS 脚本发生异常，请查看控制台日志。");
            return;
        }

        if (spawned === false) {
            player.sendMessage(ChatColor.RED + "召唤失败，可能是附近空间不足。");
            return;
        }

        if (def.consumeOnSummon === true) {
            removeSummonStick(player, def.id);
        }

        if (def.silentSummon !== true) {
            player.sendMessage(ChatColor.DARK_RED + "§l" + def.name + ChatColor.RED + " 已降临！");
        }
    }

    function processPendingSummons() {
        if (pendingSummons.length === 0) return;

        var current = pendingSummons;
        var remaining = [];
        pendingSummons = remaining;

        for (var i = 0; i < current.length; i++) {
            var pending = current[i];
            try {
                var player = pending.player;
                if (!player || !player.isOnline()) {
                    delete pendingSummonPlayers[pending.playerUuid];
                    continue;
                }

                if (callBossTick >= pending.readyTick) {
                    delete pendingSummonPlayers[pending.playerUuid];
                    executePendingSummon(pending);
                    continue;
                }

                if (callBossTick >= pending.nextAnnounceTick) {
                    pending.nextAnnounceTick += 20;
                    var seconds = Math.max(1,
                            Math.ceil((pending.readyTick - callBossTick) / 20.0));
                    announceSummonCountdown(pending, seconds);
                }
                remaining.push(pending);
            } catch (e) {
                delete pendingSummonPlayers[pending.playerUuid];
                log.error("CallBoss 召唤倒计时异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
        }
    }

    // 每秒 20 tick，倒计时使用主线程任务推进，避免 task.delay 的异步问题。
    task.repeat(ticks(1), ticks(1), function() {
        callBossTick++;
        processPendingSummons();
    });

    // ---------------------------------------------------------------------------
    // /call boss <怪物名字>
    // ---------------------------------------------------------------------------

    function sendCallUsage(sender) {
        sender.sendMessage(ChatColor.GOLD + "===== 自定义 BOSS 召唤 =====");
        sender.sendMessage(ChatColor.YELLOW + "/call boss" + ChatColor.GRAY + " —— 查看已注册的 BOSS");
        sender.sendMessage(ChatColor.YELLOW + "/call boss <怪物名字>" + ChatColor.GRAY + " —— 获得召唤烈焰棒");
        sender.sendMessage(ChatColor.GRAY + "获得烈焰棒后，手持右键点击地面，6 秒倒计时结束后召唤。");
    }

    function sendBossList(sender) {
        var list = listAliveBosses();
        if (list.length === 0) {
            sender.sendMessage(ChatColor.RED + "当前没有已注册的自定义 BOSS。");
            return;
        }
        sender.sendMessage(ChatColor.GOLD + "当前可召唤的 BOSS：");
        for (var i = 0; i < list.length; i++) {
            sender.sendMessage(ChatColor.YELLOW + " - " + ChatColor.RED + list[i].name
                    + ChatColor.GRAY + "   /call boss " + list[i].name);
        }
    }

    addCommand("call", {
        onCommand: function(sender, args) {
            if (args.length === 0 || normalizeName(args[0]) !== "boss") {
                sendCallUsage(sender);
                return;
            }

            if (args.length < 2) {
                sendBossList(sender);
                return;
            }

            if (!(sender instanceof Player)) {
                sender.sendMessage(ChatColor.RED + "该指令只能由玩家使用（控制台无法持有召唤烈焰棒）。");
                return;
            }

            var query = toArray(args).slice(1).join(" ");
            var def = resolveBoss(query);
            if (!def) {
                sender.sendMessage(ChatColor.RED + "找不到 BOSS：" + ChatColor.YELLOW + query
                        + ChatColor.RED + "。使用 /call boss 查看列表。");
                return;
            }
            if (def.ambiguous) {
                sender.sendMessage(ChatColor.RED + "匹配到多个 BOSS，请输入完整名字：");
                for (var i = 0; i < def.ambiguous.length; i++) {
                    sender.sendMessage(ChatColor.YELLOW + " - " + def.ambiguous[i].name);
                }
                return;
            }

            giveSummonStick(sender, def);
            if (def.silentSummon !== true) {
                sender.sendMessage(ChatColor.GREEN + "已获得：" + ChatColor.GOLD + "召唤" + ChatColor.RED + def.name);
                sender.sendMessage(ChatColor.GRAY + "手持烈焰棒，右键点击地面后 6 秒倒计时召唤。");
            }
        },

        onTabComplete: function(sender, args) {
            var result = [];
            if (args.length === 1) {
                result.push("boss");
                return toJavaList(result);
            }
            if (args.length === 2 && normalizeName(args[0]) === "boss") {
                var prefix = normalizeName(args[1]);
                var list = listAliveBosses();
                for (var i = 0; i < list.length; i++) {
                    if (!prefix || normalizeName(list[i].name).indexOf(prefix) === 0
                            || normalizeName(list[i].id).indexOf(prefix) === 0) {
                        result.push(list[i].name);
                    }
                }
            }
            return toJavaList(result);
        }
    });

    // ---------------------------------------------------------------------------
    // 右键地面：从烈焰棒 PDC 中取出 BOSS id，进入 6 秒倒计时后生成
    // ---------------------------------------------------------------------------

    registerEvent("org.bukkit.event.player.PlayerInteractEvent", function(event) {
        try {
            if (event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
            if (event.getHand() != EquipmentSlot.HAND) return;

            var item = event.getItem();
            if (!isSummonStick(item)) return;

            var player = event.getPlayer();
            var clickedBlock = event.getClickedBlock();
            if (!clickedBlock) return;

            var bossId = getStickBossId(item);
            var def = findBoss(bossId);
            if (!def) {
                player.sendMessage(ChatColor.RED + "该召唤烈焰棒对应的 BOSS 尚未加载，请稍后再试。");
                return;
            }

            // 一旦确认是召唤烈焰棒，就阻止其与原版方块交互（例如点火等）。
            event.setCancelled(true);

            var uuid = player.getUniqueId().toString();
            if (pendingSummonPlayers[uuid]) {
                player.sendMessage(ChatColor.GRAY + "你已经有一次召唤正在倒计时，请等待其降临。");
                return;
            }

            var now = Date.now();
            var last = summonCooldown[uuid] || 0;
            if (now - last < SUMMON_COOLDOWN_MS) {
                player.sendMessage(ChatColor.GRAY + "召唤冷却中……");
                return;
            }
            summonCooldown[uuid] = now;

            var spawnLocation = clickedBlock.getRelative(event.getBlockFace()).getLocation().add(0.5, 0, 0.5);
            spawnLocation = findSafeSpawnLocation(spawnLocation);

            var pending = {
                silent: def.silentSummon === true,
                player: player,
                playerUuid: uuid,
                bossId: def.id,
                bossName: def.name,
                location: spawnLocation,
                worldName: String(spawnLocation.getWorld().getName()),
                readyTick: callBossTick + SUMMON_COUNTDOWN_TICKS,
                nextAnnounceTick: callBossTick + 20
            };
            pendingSummons.push(pending);
            pendingSummonPlayers[uuid] = true;

            if (def.silentSummon !== true) {
                player.sendMessage(ChatColor.DARK_RED + "§l" + def.name + ChatColor.RED
                        + " 将在 " + SUMMON_COUNTDOWN_SECONDS + " 秒后降临！");
            }
            announceSummonCountdown(pending, SUMMON_COUNTDOWN_SECONDS);
        } catch (e) {
            log.error("CallBoss 右键事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 提供给其他脚本使用的共享 API。
    var BossRegistry = {
        version: 1,
        register: registerBoss,
        unregister: unregisterBoss,
        heartbeat: heartbeatBoss,
        get: findBoss,
        resolve: resolveBoss,
        list: listAliveBosses,
        createStick: createSummonStick
    };
    setShared("BossRegistry", BossRegistry);

    log.info("CallBoss 框架已加载：/call boss <怪物名字>");
})();
