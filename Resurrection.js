/*
 * Resurrection.js —— 复活旁观者倒计时（OpenJS 1.5.0）
 *
 * 指令（供命令方块使用）：
 *     /resurrection <秒数>
 *
 * 效果：
 *   - 以命令执行位置为基准，找到同世界内最近的在线玩家；
 *   - 保存该玩家当前的游戏模式与飞行状态；
 *   - 切换为旁观者模式，并私发：
 *       “已经切换为旁观者模式，请尽快前往死亡地点”
 *   - 每秒显示 actionbar / title 倒计时；
 *   - 倒计时结束后恢复玩家之前的游戏模式与飞行状态。
 *
 * 说明：
 *   - 秒数范围 1 ~ 600，单位为秒；修改 MIN_SECONDS / MAX_SECONDS 可调整范围。
 *   - 玩家中途退出时立即恢复原模式，避免重新登录后仍卡在旁观者。
 *   - 玩家 PDC 中会暂存 `resurrection_prev_mode`，用于服务器重启 / 脚本重载后兜底恢复。
 */

(function () {
    "use strict";

    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var GameMode = Java.type("org.bukkit.GameMode");
    var Player = Java.type("org.bukkit.entity.Player");
    var BlockCommandSender = Java.type("org.bukkit.command.BlockCommandSender");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");

    var COMMAND_NAME = "resurrection";
    var MIN_SECONDS = 1;
    var MAX_SECONDS = 600;
    var TICKS_PER_SECOND = 20;
    var PREV_MODE_KEY = new NamespacedKey(plugin, "resurrection_prev_mode");

    var globalTick = 0;
    var states = {}; // player uuid -> 复活状态

    // ---------------------------------------------------------------------------
    // 工具函数
    // ---------------------------------------------------------------------------

    function modeDisplayName(mode) {
        try {
            if (mode === GameMode.SURVIVAL) return "生存";
            if (mode === GameMode.CREATIVE) return "创造";
            if (mode === GameMode.ADVENTURE) return "冒险";
            if (mode === GameMode.SPECTATOR) return "旁观";
        } catch (e) { }
        return "原";
    }

    function modeFromName(text) {
        try {
            var name = String(text == null ? "" : text).toUpperCase();
            if (name === "SURVIVAL") return GameMode.SURVIVAL;
            if (name === "CREATIVE") return GameMode.CREATIVE;
            if (name === "ADVENTURE") return GameMode.ADVENTURE;
            if (name === "SPECTATOR") return GameMode.SPECTATOR;
        } catch (e) { }
        return null;
    }

    function usage(sender) {
        sender.sendMessage(ChatColor.GOLD + "===== 复活旁观者模式 =====");
        sender.sendMessage(ChatColor.YELLOW + "/resurrection <秒数>"
                + ChatColor.GRAY + " —— 给予最近玩家指定秒数的旁观者模式");
        sender.sendMessage(ChatColor.GRAY + "秒数范围：" + MIN_SECONDS + " ~ " + MAX_SECONDS);
    }

    function resolveSenderLocation(sender) {
        try {
            if (sender instanceof BlockCommandSender) {
                return sender.getBlock().getLocation();
            }
            if (sender instanceof Player) {
                return sender.getLocation();
            }
        } catch (e) { }
        return null;
    }

    function findNearestPlayer(location) {
        if (!location || !location.getWorld()) return null;
        var best = null;
        var bestDistance = Infinity;
        var players = location.getWorld().getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || !player.isOnline() || player.isDead()) continue;
            var distance = player.getLocation().distanceSquared(location);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = player;
            }
        }
        return best;
    }

    function parseSeconds(text) {
        var value = String(text == null ? "" : text).trim();
        if (!/^[0-9]+$/.test(value)) return null;
        var seconds = parseInt(value, 10);
        if (isNaN(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return null;
        return seconds;
    }

    // ---------------------------------------------------------------------------
    // PDC 兜底：服务器重启 / 脚本重载后恢复玩家模式
    // ---------------------------------------------------------------------------

    function setPreviousModeMarker(player, previousGameMode) {
        try {
            player.getPersistentDataContainer().set(PREV_MODE_KEY,
                    PersistentDataType.STRING, previousGameMode.name());
        } catch (e) {
            log.warn("Resurrection 写入玩家 PDC 模式标记失败：" + e);
        }
    }

    function clearPreviousModeMarker(player) {
        try {
            player.getPersistentDataContainer().remove(PREV_MODE_KEY);
        } catch (e) { }
    }

    function applyPreviousMode(player, previousGameMode, previousAllowFlight, previousFlying) {
        try {
            player.setGameMode(previousGameMode);
            player.setAllowFlight(previousAllowFlight);
            if (previousAllowFlight) {
                player.setFlying(previousFlying);
            } else {
                player.setFlying(false);
            }
            return true;
        } catch (e) {
            log.warn("Resurrection 恢复玩家模式失败：" + e);
            return false;
        }
    }

    function restoreMarker(player) {
        try {
            var pdc = player.getPersistentDataContainer();
            if (!pdc.has(PREV_MODE_KEY, PersistentDataType.STRING)) return false;
            var mode = modeFromName(pdc.get(PREV_MODE_KEY, PersistentDataType.STRING));
            if (mode != null) {
                player.setGameMode(mode);
                player.setAllowFlight(mode === GameMode.CREATIVE || mode === GameMode.SPECTATOR);
                try { player.setFlying(mode === GameMode.CREATIVE || mode === GameMode.SPECTATOR); } catch (e) { }
                player.sendMessage(ChatColor.GREEN + "[复活] 检测到上次未完成的旁观者状态，已恢复为 "
                        + modeDisplayName(mode) + "模式。");
            }
            pdc.remove(PREV_MODE_KEY);
            return true;
        } catch (e) {
            log.warn("Resurrection 恢复 PDC 标记失败：" + e);
            return false;
        }
    }

    function restoreMarkersOnline() {
        try {
            var players = Bukkit.getOnlinePlayers();
            var iterator = players.iterator();
            while (iterator.hasNext()) {
                restoreMarker(iterator.next());
            }
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 倒计时与恢复
    // ---------------------------------------------------------------------------

    function sendCountdown(player, seconds, forceTitle) {
        var color = seconds <= 3 ? ChatColor.RED
                : (seconds <= 10 ? ChatColor.GOLD : ChatColor.YELLOW);
        try {
            player.sendActionBar(color + "旁观者模式剩余 " + seconds + " 秒");
        } catch (e) { }

        if (forceTitle || seconds <= 3 || seconds === 5 || seconds === 10) {
            try {
                player.sendTitle(ChatColor.GOLD + "旁观者模式",
                        color + "剩余 " + seconds + " 秒", 0, 20, 5);
            } catch (e) { }
        }
    }

    function clearCountdownDisplay(player) {
        try { player.sendActionBar(ChatColor.GREEN + "倒计时结束，已恢复原游戏模式"); } catch (e) { }
    }

    function finishResurrection(player, state, silent) {
        if (!player || !state) return;
        try {
            if (player.isOnline()) {
                var restored = applyPreviousMode(player, state.previousGameMode,
                        state.previousAllowFlight, state.previousFlying);
                if (restored) {
                    clearPreviousModeMarker(player);
                }
                if (!silent) {
                    if (restored) {
                        clearCountdownDisplay(player);
                        player.sendMessage(ChatColor.GREEN
                                + "[复活] 倒计时结束，已恢复为之前的游戏模式。");
                    } else {
                        player.sendMessage(ChatColor.RED
                                + "[复活] 恢复原游戏模式失败，请联系管理员处理。");
                    }
                }
            } else {
                clearPreviousModeMarker(player);
            }
        } catch (e) {
            log.warn("Resurrection 结束恢复异常：" + e);
        }
    }

    function startResurrection(player, seconds, sender) {
        var key = String(player.getUniqueId().toString());
        var existing = states[key];
        var previousGameMode;
        var previousAllowFlight;
        var previousFlying;

        if (existing) {
            // 命令方块重复触发时保留最初保存的模式，只刷新倒计时。
            previousGameMode = existing.previousGameMode;
            previousAllowFlight = existing.previousAllowFlight;
            previousFlying = existing.previousFlying;
            log.info("Resurrection 刷新倒计时：" + player.getName() + " -> " + seconds + " 秒");
        } else {
            previousGameMode = player.getGameMode();
            previousAllowFlight = player.getAllowFlight();
            previousFlying = player.isFlying();
            setPreviousModeMarker(player, previousGameMode);
            log.info("Resurrection 开始：" + player.getName()
                    + "，原模式=" + String(previousGameMode) + "，持续 " + seconds + " 秒");
        }

        states[key] = {
            player: player,
            previousGameMode: previousGameMode,
            previousAllowFlight: previousAllowFlight,
            previousFlying: previousFlying,
            endTick: globalTick + seconds * TICKS_PER_SECOND,
            lastSecond: -1
        };

        try {
            player.setGameMode(GameMode.SPECTATOR);
        } catch (e) {
            log.warn("Resurrection 切换旁观者模式失败：" + e);
        }

        player.sendMessage(ChatColor.YELLOW + "已经切换为旁观者模式，请尽快前往死亡地点");
        try {
            player.sendTitle(ChatColor.GOLD + "旁观者模式",
                    ChatColor.YELLOW + "持续 " + seconds + " 秒，请前往死亡地点", 5, 40, 10);
        } catch (e) { }
        sendCountdown(player, seconds, true);

        if (sender) {
            sender.sendMessage(ChatColor.GREEN + "已将 " + player.getName()
                    + " 切换为旁观者模式，持续 " + seconds + " 秒。");
        }
    }

    // ---------------------------------------------------------------------------
    // 指令
    // ---------------------------------------------------------------------------

    function handleCommand(sender, args) {
        try {
            var list = args || [];
            if (list.length !== 1) {
                usage(sender);
                return;
            }

            var seconds = parseSeconds(list[0]);
            if (seconds == null) {
                sender.sendMessage(ChatColor.RED + "秒数必须是 " + MIN_SECONDS
                        + " ~ " + MAX_SECONDS + " 之间的整数。");
                usage(sender);
                return;
            }

            var location = resolveSenderLocation(sender);
            if (!location) {
                sender.sendMessage(ChatColor.RED + "该指令只能由命令方块或玩家执行。");
                return;
            }

            var nearest = findNearestPlayer(location);
            if (!nearest) {
                sender.sendMessage(ChatColor.RED + "命令方块附近没有在线玩家。");
                return;
            }

            startResurrection(nearest, seconds, sender);
        } catch (e) {
            log.error("Resurrection 指令异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            sender.sendMessage(ChatColor.RED + "执行 /resurrection 时发生异常，请查看控制台日志。");
        }
    }

    addCommand(COMMAND_NAME, {
        onCommand: handleCommand,
        onTabComplete: function (sender, args) {
            var list = args || [];
            if (list.length <= 1) return toJavaList(["5", "10", "30", "60"]);
            return toJavaList([]);
        }
    });

    // ---------------------------------------------------------------------------
    // 玩家退出 / 加入
    // ---------------------------------------------------------------------------

    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var player = event.getPlayer();
            var key = String(player.getUniqueId().toString());
            var state = states[key];
            if (state) {
                // 退出时立即恢复，避免下次登录仍停留在旁观者模式。
                if (applyPreviousMode(player, state.previousGameMode,
                        state.previousAllowFlight, state.previousFlying)) {
                    clearPreviousModeMarker(player);
                }
                delete states[key];
                log.info("Resurrection 玩家退出，已恢复模式：" + player.getName());
            }
        } catch (e) { }
    });

    registerEvent("org.bukkit.event.player.PlayerJoinEvent", function (event) {
        try {
            restoreMarker(event.getPlayer());
        } catch (e) { }
    });

    // ---------------------------------------------------------------------------
    // 主循环
    // ---------------------------------------------------------------------------

    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        for (var key in states) {
            if (!states.hasOwnProperty(key)) continue;
            var state = states[key];
            if (!state) continue;
            try {
                var player = state.player;
                if (!player || !player.isOnline()) {
                    // 掉线恢复由 PlayerQuitEvent / PDC 标记兜底，这里只清理失效状态。
                    delete states[key];
                    continue;
                }

                var remaining = state.endTick - globalTick;
                if (remaining <= 0) {
                    finishResurrection(player, state, false);
                    delete states[key];
                    log.info("Resurrection 倒计时结束：" + player.getName());
                    continue;
                }

                var seconds = Math.max(1, Math.ceil(remaining / TICKS_PER_SECOND));
                if (seconds !== state.lastSecond) {
                    state.lastSecond = seconds;
                    sendCountdown(player, seconds, false);
                }
            } catch (e) {
                log.warn("Resurrection 主循环异常：" + e);
            }
        }
    });

    // 脚本卸载 / 服务器关闭时尽量恢复；即使异步线程恢复失败，
    // PDC 标记也会在下次进入服务器时兜底恢复。
    task.bindToUnload(function () {
        try {
            for (var key in states) {
                if (!states.hasOwnProperty(key)) continue;
                var state = states[key];
                if (state && state.player && state.player.isOnline()) {
                    if (applyPreviousMode(state.player, state.previousGameMode,
                            state.previousAllowFlight, state.previousFlying)) {
                        clearPreviousModeMarker(state.player);
                    }
                }
                delete states[key];
            }
        } catch (e) { }
    });

    // 服务器启动 / 脚本重载后检查在线玩家的兜底标记。
    task.main(function () {
        restoreMarkersOnline();
    });

    log.info("Resurrection 已加载：/resurrection <秒数>（命令方块专用，单位为秒）");
})();
