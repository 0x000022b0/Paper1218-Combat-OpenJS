/*
 * SuperTNT.js —— 自定义爆炸威力的 TNT（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：
 *     /supertnt [爆炸威力，浮点数]
 *     例：/supertnt 6.5   -> 获得一枚爆炸威力 6.5 的超级 TNT
 *         /supertnt       -> 默认威力 4.0（与原版 TNT 相同）
 *
 * 使用方式：
 *     手持超级 TNT 右键放置，再用打火石 / 火焰弹 / 红石 / 火焰等任意方式点燃。
 *     引信结束后脚本取消原版爆炸，调用 World.createExplosion(Location, float, ...)
 *     按自定义小数威力手动引爆。
 *
 * 机制摘要：
 *   - BlockPlaceEvent：把 ItemStack PDC 中的威力记录到 TNT 方块坐标；
 *   - TNTPrimeEvent：TNT 被点燃时把对应威力转存为“待绑定”记录；
 *   - EntitySpawnEvent + 主循环兜底：给对应的 TNTPrimed 写入 PDC 威力标记；
 *   - ExplosionPrimeEvent：取消原版整数威力爆炸，按自定义 float 威力重新引爆。
 *
 * 契约依据：仓库根目录《OpenJS脚本数据契约.md》第 4.6 / 7.2 / 7.3 节。
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
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Location = Java.type("org.bukkit.Location");
    var Player = Java.type("org.bukkit.entity.Player");
    var TNTPrimed = Java.type("org.bukkit.entity.TNTPrimed");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var DEFAULT_POWER = 4.0;
    var MIN_POWER = 0.1;
    var MAX_POWER = 64.0;
    var BREAK_BLOCKS = true;

    var POWER_PRESETS = ["4", "8", "16", "32", "64"];

    var PLACED_TNT_TTL_TICKS = 20 * 60 * 30; // 未点燃的自定义 TNT 记录最多保留 30 分钟
    var PLACED_CLEANUP_INTERVAL_TICKS = 200; // 每 10 秒清理一次过期方块记录
    var PENDING_PRIME_TTL_TICKS = 40;        // 点燃后 2 秒仍未绑定到实体则放弃该次绑定

    var POWER_KEY = new NamespacedKey(plugin, "supertnt_power");
    var ITEM_KEY = new NamespacedKey(plugin, "supertnt_item");
    var SUPER_TNT_TAG = "supertnt_custom";

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var lastPlacedCleanupTick = 0;
    var placedTntBlocks = {}; // "worldUid:x:y:z" -> { power, tick }
    var pendingPrimes = {};   // "worldUid:x:y:z" -> { power, worldName, x, y, z, tick }

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function blockKey(world, x, y, z) {
        return String(world.getUID().toString()) + ":" + x + ":" + y + ":" + z;
    }

    function keyFromLocation(location) {
        var world = location.getWorld();
        if (world == null) return "";
        return blockKey(world,
                location.getBlockX(), location.getBlockY(), location.getBlockZ());
    }

    function normalizePower(value) {
        return Math.round(value * 1000) / 1000;
    }

    function formatPower(value) {
        var text = normalizePower(value).toFixed(3);
        text = text.replace(/0+$/, "");
        if (text.charAt(text.length - 1) === ".") {
            text = text.substring(0, text.length - 1);
        }
        return text;
    }

    function readStoredPower(container, key) {
        try {
            if (container == null || !container.has(key, PersistentDataType.STRING)) return null;
            var value = parseFloat(String(container.get(key, PersistentDataType.STRING)));
            if (isNaN(value) || !isFinite(value)) return null;
            if (value < MIN_POWER || value > MAX_POWER) return null;
            return value;
        } catch (e) {
            return null;
        }
    }

    function getItemPower(item) {
        try {
            if (item == null || item.getType() != Material.TNT || !item.hasItemMeta()) return null;
            var meta = item.getItemMeta();
            if (meta == null) return null;
            var container = meta.getPersistentDataContainer();
            if (!container.has(ITEM_KEY, PersistentDataType.STRING)) return null;
            return readStoredPower(container, POWER_KEY);
        } catch (e) {
            return null;
        }
    }

    function getEntityPower(entity) {
        try {
            if (entity == null) return null;
            var container = entity.getPersistentDataContainer();
            if (container == null) return null;
            return readStoredPower(container, POWER_KEY);
        } catch (e) {
            return null;
        }
    }

    function applyPower(entity, power) {
        try {
            entity.getPersistentDataContainer().set(POWER_KEY, PersistentDataType.STRING,
                    String(normalizePower(power)));
            entity.addScoreboardTag(SUPER_TNT_TAG);
            return true;
        } catch (e) {
            log.error("SuperTNT 写入爆炸威力标记异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    function dropLeftovers(player, leftovers) {
        if (leftovers == null || leftovers.isEmpty()) return;
        try {
            var iterator = leftovers.values().iterator();
            while (iterator.hasNext()) {
                player.getWorld().dropItemNaturally(player.getLocation(), iterator.next());
            }
            player.sendMessage(ChatColor.YELLOW + "背包已满，未能放入的超级 TNT 已掉落在你脚下。");
        } catch (e) {
            log.error("SuperTNT 掉落剩余物品异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 指令
    // -----------------------------------------------------------------------
    function createSuperTntItem(power) {
        var item = new ItemStack(Material.TNT, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.DARK_RED + "[超级 TNT] " + ChatColor.YELLOW
                + "威力 " + formatPower(power));
        meta.setLore(toJavaList([
            ChatColor.GRAY + "爆炸威力：" + ChatColor.YELLOW + formatPower(power)
                    + ChatColor.GRAY + "（原版 TNT 为 4）",
            ChatColor.GRAY + "使用自定义 float 威力，不再受原版整数限制。",
            "",
            ChatColor.YELLOW + "放置后用打火石 / 火焰 / 红石点燃。",
            ChatColor.DARK_GRAY + "可用威力：" + formatPower(MIN_POWER) + " ~ "
                    + formatPower(MAX_POWER)
        ]));

        var container = meta.getPersistentDataContainer();
        container.set(ITEM_KEY, PersistentDataType.STRING, "true");
        container.set(POWER_KEY, PersistentDataType.STRING, String(normalizePower(power)));
        item.setItemMeta(meta);
        return item;
    }

    function giveSuperTnt(player, power) {
        var item = createSuperTntItem(power);
        var leftovers = player.getInventory().addItem(item);
        dropLeftovers(player, leftovers);

        player.sendMessage(ChatColor.GREEN + "已获得 " + ChatColor.DARK_RED + "超级 TNT"
                + ChatColor.GREEN + "，爆炸威力：" + ChatColor.YELLOW + formatPower(power));
        if (power >= 32.0) {
            player.sendMessage(ChatColor.RED + "警告：高威力爆炸可能造成明显卡顿与地形破坏！");
        }
    }

    function sendSuperTntUsage(sender) {
        sender.sendMessage(ChatColor.GOLD + "===== 超级 TNT =====");
        sender.sendMessage(ChatColor.YELLOW + "/supertnt [威力]" + ChatColor.GRAY
                + " —— 获得指定爆炸威力的 TNT");
        sender.sendMessage(ChatColor.GRAY + "威力范围：" + ChatColor.YELLOW
                + formatPower(MIN_POWER) + " ~ " + formatPower(MAX_POWER)
                + ChatColor.GRAY + "，默认 " + formatPower(DEFAULT_POWER));
        sender.sendMessage(ChatColor.GRAY + "示例：" + ChatColor.YELLOW + "/supertnt 6.5");
    }

    function parsePower(text) {
        var value = String(text == null ? "" : text).trim().replace(",", ".");
        if (value.length === 0) return null;
        if (!/^\+?([0-9]+(\.[0-9]+)?|\.[0-9]+)$/.test(value)) return null;

        var power = parseFloat(value);
        if (isNaN(power) || !isFinite(power)) return null;
        if (power < MIN_POWER || power > MAX_POWER) return null;
        return normalizePower(power);
    }

    addCommand("supertnt", {
        onCommand: function (sender, args) {
            try {
                if (!(sender instanceof Player)) {
                    sender.sendMessage(ChatColor.RED
                            + "该指令只能由玩家使用（控制台无法持有 TNT）。");
                    return;
                }

                var list = toArray(args);
                if (list.length > 1) {
                    sendSuperTntUsage(sender);
                    return;
                }

                var power = DEFAULT_POWER;
                if (list.length === 1) {
                    power = parsePower(list[0]);
                    if (power == null) {
                        sender.sendMessage(ChatColor.RED + "爆炸威力必须是 "
                                + formatPower(MIN_POWER) + " ~ " + formatPower(MAX_POWER)
                                + " 之间的浮点数。");
                        sendSuperTntUsage(sender);
                        return;
                    }
                }

                giveSuperTnt(sender, power);
            } catch (e) {
                log.error("SuperTNT 指令异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                sender.sendMessage(ChatColor.RED + "处理 /supertnt 时发生异常，请查看控制台日志。");
            }
        },

        onTabComplete: function (sender, args) {
            var result = [];
            try {
                var list = toArray(args);
                if (list.length <= 1) {
                    var prefix = list.length === 1 ? String(list[0]) : "";
                    for (var i = 0; i < POWER_PRESETS.length; i++) {
                        if (prefix.length === 0 || POWER_PRESETS[i].indexOf(prefix) === 0) {
                            result.push(POWER_PRESETS[i]);
                        }
                    }
                }
            } catch (e) {
                log.error("SuperTNT Tab 补全异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
            return toJavaList(result);
        }
    });

    // -----------------------------------------------------------------------
    // 事件注册
    // -----------------------------------------------------------------------
    // 放置：把 ItemStack 上的威力记录到方块坐标上。
    registerEvent("org.bukkit.event.block.BlockPlaceEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var block = event.getBlockPlaced();
            if (block == null) return;

            var key = blockKey(block.getWorld(), block.getX(), block.getY(), block.getZ());
            // 同一坐标重新放置方块时先清除旧记录，避免误继承威力。
            if (placedTntBlocks[key]) delete placedTntBlocks[key];

            if (block.getType() != Material.TNT) return;

            var power = getItemPower(event.getItemInHand());
            if (power == null) return;

            placedTntBlocks[key] = { power: normalizePower(power), tick: globalTick };
        } catch (e) {
            log.error("SuperTNT 放置事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家挖掉未点燃的自定义 TNT：清除坐标记录。
    registerEvent("org.bukkit.event.block.BlockBreakEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var block = event.getBlock();
            if (block == null || block.getType() != Material.TNT) return;

            var key = blockKey(block.getWorld(), block.getX(), block.getY(), block.getZ());
            if (placedTntBlocks[key]) delete placedTntBlocks[key];
        } catch (e) {
            log.error("SuperTNT 破坏事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 点燃：把方块威力转存为待绑定记录；TNTPrimed 此时尚未生成。
    registerEvent("org.bukkit.event.block.TNTPrimeEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var block = event.getBlock();
            if (block == null || block.getType() != Material.TNT) return;

            var key = blockKey(block.getWorld(), block.getX(), block.getY(), block.getZ());
            var record = placedTntBlocks[key];
            if (!record) return;

            pendingPrimes[key] = {
                power: record.power,
                worldName: block.getWorld().getName(),
                x: block.getX(),
                y: block.getY(),
                z: block.getZ(),
                tick: globalTick
            };
        } catch (e) {
            log.error("SuperTNT 点燃事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 实体生成：TNTPrimed 出生位置就是 TNT 方块中心，优先在这里精确绑定。
    registerEvent("org.bukkit.event.entity.EntitySpawnEvent", function (event) {
        try {
            var entity = event.getEntity();
            if (!(entity instanceof TNTPrimed)) return;

            var key = keyFromLocation(entity.getLocation());
            var pending = pendingPrimes[key];
            if (!pending) return;

            delete pendingPrimes[key];
            delete placedTntBlocks[key];
            applyPower(entity, pending.power);
        } catch (e) {
            log.error("SuperTNT 实体生成事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 爆炸前：取消原版整数威力爆炸，用 float 参数重新引爆。
    registerEvent("org.bukkit.event.entity.ExplosionPrimeEvent", function (event) {
        try {
            var entity = event.getEntity();
            if (!(entity instanceof TNTPrimed)) return;

            var power = getEntityPower(entity);
            if (power == null) return;

            // 必须先取消，否则原版会再按 TNT 的整数威力炸一次。
            event.setCancelled(true);

            var location = entity.getLocation();
            var world = location.getWorld();
            if (world == null) return;

            // 契约 4.6 / 7.2：Nashorn 下必须使用 5 参数重载并补 null Entity，
            // 否则会报 NoSuchMethodException: Can't unambiguously select ...。
            world.createExplosion(location, power, false, BREAK_BLOCKS === true, null);
        } catch (e) {
            log.error("SuperTNT 爆炸事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 主循环：兜底绑定 + 过期记录清理
    // -----------------------------------------------------------------------
    function resolvePendingPrimes() {
        for (var key in pendingPrimes) {
            if (!pendingPrimes.hasOwnProperty(key)) continue;

            var pending = pendingPrimes[key];
            if (globalTick - pending.tick < 1) continue;

            var matched = false;
            var world = Bukkit.getWorld(pending.worldName);
            if (world != null) {
                try {
                    var center = new Location(world,
                            pending.x + 0.5, pending.y, pending.z + 0.5);
                    // 0.75 格足以覆盖刚生成、只受微小重力位移的 TNTPrimed，
                    // 同时避免把相邻方块点燃的其他 TNT 误绑到本次记录上。
                    var nearby = world.getNearbyEntities(center, 0.75, 0.75, 0.75);
                    var iterator = nearby.iterator();
                    while (iterator.hasNext()) {
                        var entity = iterator.next();
                        if (!(entity instanceof TNTPrimed)) continue;
                        if (getEntityPower(entity) != null) continue;
                        if (applyPower(entity, pending.power)) {
                            matched = true;
                            break;
                        }
                    }
                } catch (e) {
                    log.error("SuperTNT 兜底绑定异常：" + e
                            + (e && e.stack ? "\n" + e.stack : ""));
                }
            }

            if (matched) {
                delete pendingPrimes[key];
                delete placedTntBlocks[key];
            } else if (globalTick - pending.tick > PENDING_PRIME_TTL_TICKS) {
                // 只丢弃本次绑定；方块记录保留，玩家可以重新点燃。
                delete pendingPrimes[key];
            }
        }
    }

    function cleanupPlacedTntBlocks() {
        if (globalTick - lastPlacedCleanupTick < PLACED_CLEANUP_INTERVAL_TICKS) return;
        lastPlacedCleanupTick = globalTick;

        for (var key in placedTntBlocks) {
            if (!placedTntBlocks.hasOwnProperty(key)) continue;
            var record = placedTntBlocks[key];
            if (globalTick - record.tick > PLACED_TNT_TTL_TICKS) {
                delete placedTntBlocks[key];
            }
        }
    }

    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            resolvePendingPrimes();
            cleanupPlacedTntBlocks();
        } catch (e) {
            log.error("SuperTNT 主循环异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    try {
        task.bindToUnload(function () {
            placedTntBlocks = {};
            pendingPrimes = {};
        });
    } catch (e) { }

    log.info("SuperTNT 已加载：/supertnt [威力] 获取自定义 float 爆炸威力的 TNT。");
})();
