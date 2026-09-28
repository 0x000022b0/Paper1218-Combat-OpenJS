/*
 * AxiomApiTest.js —— OpenJS 调用 AxiomPaper API 生成方块的通用性测试（OpenJS 1.5.0 / AxiomPaper 5.0.1）
 *
 * 测试内容：
 *   1. OpenJS（Nashorn）能否加载 AxiomPaper / NMS / CraftBukkit 类；
 *   2. 能否调用 AxiomPaper 公开 API（AxiomCustomBlocksAPI）注册自定义方块；
 *   3. 能否通过 Axiom 内部管线（BlockBuffer + SetBlockBufferOperation + OperationQueue）
 *      在服务端生成指定方块（该路径不需要 Axiom 客户端在线，但需要一个 ServerPlayer executor）；
 *   4. 无在线玩家时 place / fill / clear 自动降级为 Bukkit 基线（明确标注，不算 Axiom API）。
 *
 * 命令：
 *   /axiomtest probe                                    探测类可见性与 API 可用性
 *   /axiomtest register                                 调用 Axiom API 注册测试自定义方块
 *   /axiomtest unregister                               注销 OpenJS 注册的 Axiom 自定义方块
 *   /axiomtest place <x> <y> <z> <blockData>            通过 Axiom 管线放置单个方块
 *   /axiomtest fill <x1> <y1> <z1> <x2> <y2> <z2> <bd>  通过 Axiom 管线填充区域
 *   /axiomtest clear <x1> <y1> <z1> <x2> <y2> <z2>      通过 Axiom 管线清空区域（air）
 */
(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // 1. Java 类型
    // ---------------------------------------------------------------------
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var Player = Java.type("org.bukkit.entity.Player");
    var CraftPlayer = Java.type("org.bukkit.craftbukkit.entity.CraftPlayer");
    var CraftBlockData = Java.type("org.bukkit.craftbukkit.block.data.CraftBlockData");
    var Class = Java.type("java.lang.Class");

    var AxiomPaper = Java.type("com.moulberry.axiom.AxiomPaper");
    var AxiomCustomBlocksAPI = Java.type("com.moulberry.axiom.paperapi.AxiomCustomBlocksAPI");
    var Key = Java.type("net.kyori.adventure.key.Key");
    var BlockBuffer = Java.type("com.moulberry.axiom.buffer.BlockBuffer");
    var SetBlockBufferOperation = Java.type("com.moulberry.axiom.operations.SetBlockBufferOperation");

    var NmsBlock = Java.type("net.minecraft.world.level.block.Block");

    // ---------------------------------------------------------------------
    // 2. 常量
    // ---------------------------------------------------------------------
    var TEST_KEY_NAMESPACE = "openjs_test";
    var TEST_KEY_PATH = "axiom_api_test";
    var TEST_TRANSLATION = "openjs.test.axiom_api_test";
    var TEST_VANILLA_BLOCK = "minecraft:stone";
    var MAX_FILL_VOLUME = 4096;
    var VERIFY_MAX_ATTEMPTS = 100;

    // ---------------------------------------------------------------------
    // 3. 工具函数
    // ---------------------------------------------------------------------
    function logInfo(message) {
        log.info("[AxiomApiTest] " + message);
    }

    function logError(message) {
        log.error("[AxiomApiTest] " + message);
    }

    function send(sender, message) {
        try {
            sender.sendMessage(ChatColor.GOLD + "[AxiomApiTest] " + ChatColor.RESET + message);
        } catch (ignored) {
        }
    }

    function probeClass(name) {
        try {
            var c = Class.forName(name);
            return "OK   " + c.getName();
        } catch (e) {
            return "FAIL " + name + " : " + e;
        }
    }

    function buildBlockState(blockString) {
        var blockData = Bukkit.createBlockData(blockString);
        try {
            return blockData.getState();
        } catch (e) {
            return CraftBlockData.class.cast(blockData).getState();
        }
    }

    function findOnlinePlayer() {
        var iterator = Bukkit.getOnlinePlayers().iterator();
        if (iterator.hasNext()) {
            return iterator.next();
        }
        return null;
    }

    // 返回 { player, world }：优先使用命令发送者；控制台则使用第一个在线玩家。
    function resolveTarget(sender) {
        if (sender instanceof Player) {
            return { player: sender, world: sender.getWorld() };
        }
        var online = findOnlinePlayer();
        if (online !== null) {
            return { player: online, world: online.getWorld() };
        }
        var worlds = Bukkit.getWorlds();
        return { player: null, world: worlds.isEmpty() ? null : worlds.get(0) };
    }

    function parseCoordinates(args, startIndex, count) {
        var values = [];
        for (var i = 0; i < count; i++) {
            var value = parseInt(args[startIndex + i], 10);
            if (isNaN(value)) {
                return null;
            }
            values.push(value);
        }
        return values;
    }

    function forEachPosition(min, max, callback) {
        for (var x = min[0]; x <= max[0]; x++) {
            for (var y = min[1]; y <= max[1]; y++) {
                for (var z = min[2]; z <= max[2]; z++) {
                    callback(x, y, z);
                }
            }
        }
    }

    function volume(min, max) {
        return (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
    }

    // 通过 Axiom 内部 BlockBuffer 管线生成方块；需要 ServerPlayer 作为 executor。
    function enqueueAxiomBlockChange(target, min, max, blockString) {
        if (target.player === null) {
            return { ok: false, reason: "没有在线玩家可作为 Axiom 管线的 ServerPlayer executor" };
        }

        var blockState;
        try {
            blockState = buildBlockState(blockString);
        } catch (e) {
            return { ok: false, reason: "方块 ID 解析失败：" + blockString + " / " + e };
        }

        var serverPlayer;
        try {
            serverPlayer = CraftPlayer.class.cast(target.player).getHandle();
        } catch (e) {
            return { ok: false, reason: "获取 ServerPlayer 失败：" + e };
        }

        var serverLevel = serverPlayer.level();
        var buffer = new BlockBuffer(NmsBlock.BLOCK_STATE_REGISTRY);
        forEachPosition(min, max, function (x, y, z) {
            buffer.set(x, y, z, blockState);
        });

        var operation = new SetBlockBufferOperation(serverPlayer, buffer, false);
        AxiomPaper.PLUGIN.addPendingOperation(serverLevel, operation);

        return {
            ok: true,
            executor: target.player.getName(),
            world: target.world.getName(),
            sections: buffer.getSectionCount()
        };
    }

    // 对比基线：直接调用 Bukkit World#setBlockData，不经过 Axiom。
    function applyBukkitBlockChange(min, max, blockString, world) {
        var blockData = Bukkit.createBlockData(blockString);
        forEachPosition(min, max, function (x, y, z) {
            world.setBlockData(x, y, z, blockData);
        });
        return { ok: true, world: world.getName() };
    }

    // 轮询验证实际方块；分块异步加载未完成时最多等待 VERIFY_MAX_ATTEMPTS tick。
    function scheduleVerify(world, min, max, blockString, route) {
        var expected = Bukkit.createBlockData(blockString);
        var attempts = 0;
        var taskId = task.repeat(ticks(1), ticks(1), function () {
            attempts++;
            var actual = world.getBlockData(min[0], min[1], min[2]);
            if (actual.matches(expected) || attempts >= VERIFY_MAX_ATTEMPTS) {
                task.cancel(taskId);
                logInfo("验证(" + route + ") " + min[0] + "," + min[1] + "," + min[2]
                        + " 实际=" + actual.getAsString() + " 期望=" + expected.getAsString()
                        + " 轮询=" + attempts + " tick");
            }
        });
    }

    function runBlockChange(sender, args, isFill) {
        var min;
        var max;
        var blockString;

        if (isFill) {
            var coords = parseCoordinates(args, 1, 6);
            if (coords === null || args.length < 8) {
                send(sender, ChatColor.RED + "用法: /axiomtest fill <x1> <y1> <z1> <x2> <y2> <z2> <blockData>");
                return;
            }
            min = [Math.min(coords[0], coords[3]), Math.min(coords[1], coords[4]), Math.min(coords[2], coords[5])];
            max = [Math.max(coords[0], coords[3]), Math.max(coords[1], coords[4]), Math.max(coords[2], coords[5])];
            blockString = args[7];
        } else {
            var single = parseCoordinates(args, 1, 3);
            if (single === null || args.length < 5) {
                send(sender, ChatColor.RED + "用法: /axiomtest place <x> <y> <z> <blockData>");
                return;
            }
            min = single;
            max = [single[0], single[1], single[2]];
            blockString = args[4];
        }

        var count = volume(min, max);
        if (count > MAX_FILL_VOLUME) {
            send(sender, ChatColor.RED + "体积 " + count + " 超过测试上限 " + MAX_FILL_VOLUME + "。");
            return;
        }

        var target = resolveTarget(sender);
        if (target.world === null) {
            send(sender, ChatColor.RED + "找不到可用世界。");
            return;
        }

        var route = target.player !== null ? "Axiom-Pipeline" : "Bukkit-Fallback(非Axiom)";
        var result = target.player !== null
                ? enqueueAxiomBlockChange(target, min, max, blockString)
                : applyBukkitBlockChange(min, max, blockString, target.world);

        if (!result.ok) {
            send(sender, ChatColor.RED + result.reason);
            logError("生成失败(" + route + "): " + result.reason);
            return;
        }

        var summary = "route=" + route + " world=" + result.world + " 方块=" + blockString
                + " 数量=" + count + " 范围=[" + min.join(",") + "]->[" + max.join(",") + "]";
        if (result.executor) {
            summary += " executor=" + result.executor;
        }
        if (result.sections !== undefined) {
            summary += " section=" + result.sections;
        }
        logInfo("已提交生成: " + summary);
        send(sender, "已提交生成（" + route + "），验证结果稍后输出到控制台。");
        scheduleVerify(target.world, min, max, blockString, route);
    }

    function cmdProbe(sender) {
        logInfo("===== AxiomPaper 类可见性 =====");
        var names = [
            "com.moulberry.axiom.AxiomPaper",
            "com.moulberry.axiom.paperapi.AxiomCustomBlocksAPI",
            "com.moulberry.axiom.paperapi.block.AxiomCustomBlockBuilder",
            "com.moulberry.axiom.buffer.BlockBuffer",
            "com.moulberry.axiom.operations.SetBlockBufferOperation",
            "com.moulberry.axiom.operations.OperationQueue",
            "net.minecraft.core.IdMapper",
            "net.minecraft.world.level.block.Block",
            "org.bukkit.craftbukkit.block.data.CraftBlockData",
            "net.kyori.adventure.key.Key"
        ];
        for (var i = 0; i < names.length; i++) {
            logInfo(probeClass(names[i]));
        }

        try {
            logInfo("AxiomCustomBlocksAPI.getAPI() = " + AxiomCustomBlocksAPI.getAPI());
        } catch (e) {
            logError("AxiomCustomBlocksAPI.getAPI() 失败: " + e);
        }
        try {
            logInfo("AxiomPaper.PLUGIN = " + AxiomPaper.PLUGIN);
        } catch (e2) {
            logError("AxiomPaper.PLUGIN 失败: " + e2);
        }
        try {
            logInfo("Block.BLOCK_STATE_REGISTRY size=" + NmsBlock.BLOCK_STATE_REGISTRY.size());
        } catch (e3) {
            logError("Block.BLOCK_STATE_REGISTRY 失败: " + e3);
        }
        try {
            logInfo("buildBlockState(minecraft:stone) = " + buildBlockState("minecraft:stone"));
        } catch (e4) {
            logError("buildBlockState 失败: " + e4);
        }
        send(sender, "探测完成，详见控制台日志。");
    }

    function cmdRegister(sender) {
        try {
            var api = AxiomCustomBlocksAPI.getAPI();
            api.unregisterAll(plugin);
            var key = Key.key(TEST_KEY_NAMESPACE, TEST_KEY_PATH);
            var builder = api.createSingle(key, TEST_TRANSLATION, Bukkit.createBlockData(TEST_VANILLA_BLOCK));
            api.register(plugin, builder);
            logInfo("Axiom API 注册成功: key=" + key + " vanilla=" + TEST_VANILLA_BLOCK);
            send(sender, ChatColor.GREEN + "Axiom 自定义方块注册成功。");
        } catch (e) {
            logError("Axiom API 注册失败: " + e);
            send(sender, ChatColor.RED + "注册失败: " + e);
        }
    }

    function cmdUnregister(sender) {
        try {
            AxiomCustomBlocksAPI.getAPI().unregisterAll(plugin);
            logInfo("Axiom API 自定义方块已注销（unregisterAll）。");
            send(sender, ChatColor.GREEN + "已注销 OpenJS 注册的 Axiom 自定义方块。");
        } catch (e) {
            logError("注销失败: " + e);
            send(sender, ChatColor.RED + "注销失败: " + e);
        }
    }

    function showHelp(sender) {
        send(sender, ChatColor.YELLOW + "/axiomtest probe");
        send(sender, ChatColor.YELLOW + "/axiomtest register | unregister");
        send(sender, ChatColor.YELLOW + "/axiomtest place <x> <y> <z> <blockData>");
        send(sender, ChatColor.YELLOW + "/axiomtest fill <x1> <y1> <z1> <x2> <y2> <z2> <blockData>");
        send(sender, ChatColor.YELLOW + "/axiomtest clear <x1> <y1> <z1> <x2> <y2> <z2>");
    }

    addCommand("axiomtest", {
        onCommand: function (sender, javaArgs) {
            var args = toArray(javaArgs);
            var sub = args.length > 0 ? String(args[0]).toLowerCase() : "help";
            try {
                if (sub === "probe") {
                    cmdProbe(sender);
                } else if (sub === "register") {
                    cmdRegister(sender);
                } else if (sub === "unregister") {
                    cmdUnregister(sender);
                } else if (sub === "place") {
                    runBlockChange(sender, args, false);
                } else if (sub === "fill") {
                    runBlockChange(sender, args, true);
                } else if (sub === "clear") {
                    var clearArgs = [args[0]];
                    for (var i = 1; i <= 6 && i < args.length; i++) {
                        clearArgs.push(args[i]);
                    }
                    clearArgs.push("minecraft:air");
                    runBlockChange(sender, clearArgs, true);
                } else {
                    showHelp(sender);
                }
            } catch (e) {
                logError("命令执行异常: " + e + (e && e.stack ? "\n" + e.stack : ""));
                send(sender, ChatColor.RED + "执行异常，详见控制台。");
            }
            return true;
        }
    });

    logInfo("测试脚本已加载。使用 /axiomtest help 查看命令。");
})();
