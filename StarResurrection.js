/*
 * StarResurrection.js —— 下界之星复活（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 指令：
 *   /starresurrection <all|玩家名> <true|false>
 *     /starresurrection all true       -> 全体默认开启（清空个人覆盖）
 *     /starresurrection all false      -> 全体关闭（清空个人覆盖）
 *     /starresurrection <玩家名> true  -> 仅该玩家开启
 *     /starresurrection <玩家名> false -> 仅该玩家关闭
 *   不带参数执行时查看当前状态与用法。
 *
 * 效果：
 *   开启后，玩家受到致命伤害或死亡时，如果背包（含副手）里有下界之星，
 *   消耗 1 枚并立即复活：保留 1 点生命，并获得原版不死图腾同款效果：
 *   生命恢复 II 45 秒、伤害吸收 II 5 秒、抗火 I 40 秒，附带图腾音效与粒子。
 *
 * 说明：
 *   - 优先拦截致命 EntityDamageEvent，避免进入死亡结算；
 *   - PlayerDeathEvent 兜底 /kill 等绕过伤害事件的死亡路径；
 *   - 状态保存到主世界 PDC，脚本 / 服务器重启后保留；
 *   - all 指令会清空个人覆盖，个人指令设置的覆盖优先。
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Material = Java.type("org.bukkit.Material");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Player = Java.type("org.bukkit.entity.Player");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var RESURRECTION_HEALTH = 1.0;

    var REGEN_TICKS = 20 * 45;
    var REGEN_AMPLIFIER = 1;
    var ABSORPTION_TICKS = 20 * 5;
    var ABSORPTION_AMPLIFIER = 1;
    var FIRE_RESISTANCE_TICKS = 20 * 40;
    var FIRE_RESISTANCE_AMPLIFIER = 0;

    var STATE_KEY = new NamespacedKey(plugin, "star_resurrection_state");

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var stateLoaded = false;
    var allEnabled = false;   // all 默认开关
    var playerOverrides = {}; // playerUuid -> true / false
    var lastResurrectTick = {}; // playerUuid -> 最近一次复活所在 tick，防止同一 tick 重复消耗

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function mainWorld() {
        try {
            return Bukkit.getWorlds().get(0);
        } catch (e) {
            return null;
        }
    }

    function playerUuid(player) {
        return String(player.getUniqueId().toString());
    }

    function normalizeName(value) {
        return String(value == null ? "" : value).trim().toLowerCase();
    }

    function currentTick() {
        try {
            return Bukkit.getCurrentTick();
        } catch (e) {
            return -1;
        }
    }

    function ensureStateLoaded() {
        if (stateLoaded) return;
        stateLoaded = true;
        loadState();
    }

    function loadState() {
        try {
            var world = mainWorld();
            if (world == null) return;

            var container = world.getPersistentDataContainer();
            if (!container.has(STATE_KEY, PersistentDataType.STRING)) return;

            var raw = String(container.get(STATE_KEY, PersistentDataType.STRING));
            if (!raw) return;

            var parts = raw.split("|");
            for (var i = 0; i < parts.length; i++) {
                var token = String(parts[i]).trim();
                if (!token) continue;

                var splitIndex = token.lastIndexOf(":");
                if (splitIndex <= 0 || splitIndex >= token.length - 1) continue;

                var key = token.substring(0, splitIndex);
                var value = token.substring(splitIndex + 1) === "1";

                if (key === "all") {
                    allEnabled = value;
                } else {
                    playerOverrides[key] = value;
                }
            }
        } catch (e) {
            log.error("StarResurrection 状态读取异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function saveState() {
        try {
            var world = mainWorld();
            if (world == null) {
                log.error("StarResurrection 无法保存状态：主世界未加载。");
                return;
            }

            var parts = ["all:" + (allEnabled ? "1" : "0")];
            for (var uuid in playerOverrides) {
                if (!playerOverrides.hasOwnProperty(uuid)) continue;
                parts.push(uuid + ":" + (playerOverrides[uuid] === true ? "1" : "0"));
            }

            world.getPersistentDataContainer().set(STATE_KEY, PersistentDataType.STRING,
                    parts.join("|"));
        } catch (e) {
            log.error("StarResurrection 状态保存异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function isGameModeResurrectable(player) {
        try {
            var gameMode = player.getGameMode();
            if (gameMode == null) return true;
            var name = String(gameMode.name());
            return name !== "CREATIVE" && name !== "SPECTATOR";
        } catch (e) {
            return true;
        }
    }

    function isEnabledFor(player) {
        ensureStateLoaded();
        var uuid = playerUuid(player);
        if (playerOverrides.hasOwnProperty(uuid)) {
            return playerOverrides[uuid] === true;
        }
        return allEnabled;
    }

    function isResurrectionAllowed(player) {
        if (player == null || !player.isOnline() || player.isDead()) return false;
        if (!isGameModeResurrectable(player)) return false;
        if (!isEnabledFor(player)) return false;

        var uuid = playerUuid(player);
        return lastResurrectTick[uuid] !== currentTick();
    }

    // 从主背包（0~35）或副手中扣除 1 枚下界之星，成功返回 true。
    function consumeNetherStar(player) {
        try {
            var inventory = player.getInventory();

            for (var slot = 0; slot < 36; slot++) {
                var item = inventory.getItem(slot);
                if (item == null || item.getType() != Material.NETHER_STAR) continue;

                if (item.getAmount() > 1) {
                    item.setAmount(item.getAmount() - 1);
                    inventory.setItem(slot, item);
                } else {
                    inventory.setItem(slot, null);
                }
                return true;
            }

            var offhand = inventory.getItemInOffHand();
            if (offhand != null && offhand.getType() == Material.NETHER_STAR) {
                if (offhand.getAmount() > 1) {
                    offhand.setAmount(offhand.getAmount() - 1);
                    inventory.setItemInOffHand(offhand);
                } else {
                    inventory.setItemInOffHand(null);
                }
                return true;
            }

            return false;
        } catch (e) {
            log.error("StarResurrection 扣除下界之星异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    function markResurrected(player) {
        try {
            lastResurrectTick[playerUuid(player)] = currentTick();
        } catch (e) { }
    }

    function playResurrectionEffects(player) {
        try {
            player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION,
                    REGEN_TICKS, REGEN_AMPLIFIER));
            player.addPotionEffect(new PotionEffect(PotionEffectType.ABSORPTION,
                    ABSORPTION_TICKS, ABSORPTION_AMPLIFIER));
            player.addPotionEffect(new PotionEffect(PotionEffectType.FIRE_RESISTANCE,
                    FIRE_RESISTANCE_TICKS, FIRE_RESISTANCE_AMPLIFIER));
        } catch (e) {
            log.error("StarResurrection 添加复活效果异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }

        try {
            var location = player.getLocation();
            player.getWorld().playSound(location, Sound.ITEM_TOTEM_USE, 1.0, 1.0);
            player.getWorld().spawnParticle(Particle.TOTEM_OF_UNDYING,
                    location.getX(), location.getY() + 1.0, location.getZ(),
                    30, 0.5, 0.5, 0.5, 0.5);
            player.sendMessage(ChatColor.GOLD + "[星之复活] " + ChatColor.YELLOW
                    + "下界之星碎裂，你从死亡边缘被拉了回来！");
        } catch (e) {
            log.error("StarResurrection 播放复活特效异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function parseBoolean(value) {
        var text = normalizeName(value);
        if (text === "true" || text === "on" || text === "yes" || text === "1") return true;
        if (text === "false" || text === "off" || text === "no" || text === "0") return false;
        return null;
    }

    function findOnlinePlayer(query) {
        var target = normalizeName(query);
        if (!target) return null;

        var players = Bukkit.getOnlinePlayers();
        var iterator = players.iterator();
        while (iterator.hasNext()) {
            var player = iterator.next();
            if (normalizeName(player.getName()) === target) return player;
        }
        return null;
    }

    function getOverrideDisplayName(uuid) {
        var text = String(uuid);
        try {
            var players = Bukkit.getOnlinePlayers();
            var iterator = players.iterator();
            while (iterator.hasNext()) {
                var player = iterator.next();
                if (String(player.getUniqueId().toString()) === text) {
                    return String(player.getName());
                }
            }
        } catch (e) { }

        return text.length > 8 ? text.substring(0, 8) : text;
    }

    // -----------------------------------------------------------------------
    // 指令
    // -----------------------------------------------------------------------
    function sendUsage(sender) {
        sender.sendMessage(ChatColor.YELLOW + "/starresurrection <all|玩家名> <true|false>"
                + ChatColor.GRAY + " —— 开启 / 关闭下界之星复活");
        sender.sendMessage(ChatColor.GRAY + "示例：" + ChatColor.YELLOW
                + "/starresurrection all true" + ChatColor.GRAY + "、"
                + ChatColor.YELLOW + "/starresurrection XP false");
        sender.sendMessage(ChatColor.GRAY + "效果：死亡时消耗 1 枚下界之星，"
                + "保留 1 点生命原地复活。");
    }

    function sendStatus(sender) {
        ensureStateLoaded();

        sender.sendMessage(ChatColor.GOLD + "===== 下界之星复活 =====");
        sender.sendMessage(ChatColor.GRAY + "全局默认：" + (allEnabled
                ? ChatColor.GREEN + "开启" : ChatColor.RED + "关闭"));

        var hasOverride = false;
        for (var uuid in playerOverrides) {
            if (playerOverrides.hasOwnProperty(uuid)) {
                hasOverride = true;
                break;
            }
        }

        if (hasOverride) {
            sender.sendMessage(ChatColor.GRAY + "个人覆盖（优先于全局默认）：");
            for (var playerUuidKey in playerOverrides) {
                if (!playerOverrides.hasOwnProperty(playerUuidKey)) continue;
                sender.sendMessage(ChatColor.YELLOW + " - " + getOverrideDisplayName(playerUuidKey)
                        + ChatColor.GRAY + "：" + (playerOverrides[playerUuidKey] === true
                                ? ChatColor.GREEN + "开启" : ChatColor.RED + "关闭"));
            }
        } else {
            sender.sendMessage(ChatColor.GRAY + "当前没有个人覆盖设置。");
        }

        if (sender instanceof Player) {
            sender.sendMessage(ChatColor.GRAY + "你的当前状态：" + (isEnabledFor(sender)
                    ? ChatColor.GREEN + "开启" : ChatColor.RED + "关闭"));
        }

        sendUsage(sender);
    }

    addCommand("starresurrection", {
        onCommand: function (sender, args) {
            try {
                ensureStateLoaded();

                var list = toArray(args);
                if (list.length === 0) {
                    sendStatus(sender);
                    return;
                }

                if (list.length !== 2) {
                    sender.sendMessage(ChatColor.RED + "参数格式：/starresurrection <all|玩家名> <true|false>");
                    sendUsage(sender);
                    return;
                }

                var targetName = String(list[0]).trim();
                var enabled = parseBoolean(list[1]);
                if (enabled === null) {
                    sender.sendMessage(ChatColor.RED + "布尔值只能是 true / false（也支持 on / off）。");
                    return;
                }

                if (normalizeName(targetName) === "all") {
                    allEnabled = enabled;
                    playerOverrides = {};
                    saveState();
                    sender.sendMessage(ChatColor.GREEN + "已为全体玩家"
                            + (enabled ? "开启" : "关闭") + "下界之星复活"
                            + ChatColor.GRAY + "（个人覆盖已清空）。");
                    return;
                }

                var player = findOnlinePlayer(targetName);
                if (player == null) {
                    sender.sendMessage(ChatColor.RED + "玩家不在线：" + ChatColor.YELLOW + targetName
                            + ChatColor.RED + "。请使用在线玩家名，或使用 all。");
                    return;
                }

                playerOverrides[playerUuid(player)] = enabled;
                saveState();
                sender.sendMessage(ChatColor.GREEN + "已为玩家 " + ChatColor.YELLOW + player.getName()
                        + ChatColor.GREEN + (enabled ? "开启" : "关闭") + "下界之星复活。");
            } catch (e) {
                log.error("StarResurrection 指令异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                sender.sendMessage(ChatColor.RED
                        + "处理 /starresurrection 时发生异常，请查看控制台日志。");
            }
        },

        onTabComplete: function (sender, args) {
            var result = [];
            try {
                var list = toArray(args);
                if (list.length <= 1) {
                    var prefix = list.length === 1 ? normalizeName(list[0]) : "";
                    if (prefix.length === 0 || "all".indexOf(prefix) === 0) result.push("all");

                    var players = Bukkit.getOnlinePlayers();
                    var iterator = players.iterator();
                    while (iterator.hasNext()) {
                        var player = iterator.next();
                        var name = String(player.getName());
                        if (prefix.length === 0 || normalizeName(name).indexOf(prefix) === 0) {
                            result.push(name);
                        }
                    }
                } else if (list.length === 2) {
                    var valuePrefix = normalizeName(list[1]);
                    if (valuePrefix.length === 0 || "true".indexOf(valuePrefix) === 0) {
                        result.push("true");
                    }
                    if (valuePrefix.length === 0 || "false".indexOf(valuePrefix) === 0) {
                        result.push("false");
                    }
                }
            } catch (e) {
                log.error("StarResurrection Tab 补全异常：" + e
                        + (e && e.stack ? "\n" + e.stack : ""));
            }
            return toJavaList(result);
        }
    });

    // -----------------------------------------------------------------------
    // 事件注册
    // -----------------------------------------------------------------------
    // 致命伤害优先拦截：取消伤害并立刻复活，避免进入死亡结算。
    registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var entity = event.getEntity();
            if (!(entity instanceof Player)) return;

            var player = entity;
            if (!isResurrectionAllowed(player)) return;

            var finalDamage = event.getFinalDamage();
            if (!(finalDamage > 0.0) || player.getHealth() <= 0.0) return;
            if (player.getHealth() - finalDamage > 0.0) return;

            if (!consumeNetherStar(player)) return;

            markResurrected(player);
            event.setCancelled(true);
            player.setHealth(RESURRECTION_HEALTH);
            playResurrectionEffects(player);
        } catch (e) {
            log.error("StarResurrection 致命伤害事件异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 死亡事件兜底：处理 /kill 等不经过普通伤害事件的死亡路径。
    registerEvent("org.bukkit.event.entity.PlayerDeathEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var entity = event.getEntity();
            if (!(entity instanceof Player)) return;

            var player = entity;
            if (!isResurrectionAllowed(player)) return;
            if (!consumeNetherStar(player)) return;

            markResurrected(player);
            event.setReviveHealth(RESURRECTION_HEALTH);
            event.setCancelled(true);
            try { event.setShouldPlayDeathSound(false); } catch (ignored) { }
            playResurrectionEffects(player);
        } catch (e) {
            log.error("StarResurrection 死亡事件异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    log.info("StarResurrection 已加载：/starresurrection <all|玩家名> <true|false> 管理下界之星复活。");
})();
