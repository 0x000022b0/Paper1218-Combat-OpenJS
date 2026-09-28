/*
 * AxiomAdvancedTest.js —— OpenJS 调用 AxiomPaper 高级功能测试（群系绘制 / 蓝图放置）
 *
 * 结论先行：
 *   - AxiomPaper 服务端没有雕刻/破碎等工具算法，这些在 Axiom 客户端执行；
 *     服务端只能通过 SetBlockBuffer 管线接收“工具结果”。
 *   - 群系绘制：AxiomPaper 有 BiomeBuffer + 私有 applyBiomeBuffer 处理器，
 *     OpenJS 可以构造 BiomeBuffer，并通过模拟 Axiom 客户端数据包触发它。
 *   - 蓝图放置：AxiomPaper 有 BlueprintIo/RawBlueprint 读写和 ServerBlueprintManager 分发，
 *     但没有服务端“粘贴”方法；OpenJS 可读取 .bp 后自行送入 BlockBuffer 管线放置。
 *
 * 命令：
 *   /axiomadv biome <x1> <y1> <z1> <x2> <y2> <z2> <biomeId>   模拟 Axiom 群系绘制包
 *   /axiomadv bp <x> <y> <z>                                   生成测试 .bp 并放置
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
    var BiomeBuffer = Java.type("com.moulberry.axiom.buffer.BiomeBuffer");
    var BlockBuffer = Java.type("com.moulberry.axiom.buffer.BlockBuffer");
    var SetBlockBufferOperation = Java.type("com.moulberry.axiom.operations.SetBlockBufferOperation");
    var SetBlockBufferPacketListener = Java.type("com.moulberry.axiom.packet.impl.SetBlockBufferPacketListener");

    var RegistryFriendlyByteBuf = Java.type("net.minecraft.network.RegistryFriendlyByteBuf");
    var Unpooled = Java.type("io.netty.buffer.Unpooled");
    var BlockPos = Java.type("net.minecraft.core.BlockPos");
    var Block = Java.type("net.minecraft.world.level.block.Block");
    var Registries = Java.type("net.minecraft.core.registries.Registries");
    var ResourceLocation = Java.type("net.minecraft.resources.ResourceLocation");
    var ResourceKey = Java.type("net.minecraft.resources.ResourceKey");

    var Long2ObjectOpenHashMap = Java.type("it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap");
    var ArrayList = Java.type("java.util.ArrayList");
    var File = Java.type("java.io.File");
    var FileInputStream = Java.type("java.io.FileInputStream");
    var FileOutputStream = Java.type("java.io.FileOutputStream");
    var BlueprintHeader = Java.type("com.moulberry.axiom.blueprint.BlueprintHeader");
    var RawBlueprint = Java.type("com.moulberry.axiom.blueprint.RawBlueprint");
    var BlueprintIo = Java.type("com.moulberry.axiom.blueprint.BlueprintIo");

    // ---------------------------------------------------------------------
    // 2. 常量
    // ---------------------------------------------------------------------
    var MAX_VOLUME = 8192;
    var VERIFY_MAX_ATTEMPTS = 60;

    // ---------------------------------------------------------------------
    // 3. 工具函数
    // ---------------------------------------------------------------------
    function logInfo(message) {
        log.info("[AxiomAdvancedTest] " + message);
    }

    function logError(message) {
        log.error("[AxiomAdvancedTest] " + message);
    }

    function send(sender, message) {
        try {
            sender.sendMessage(ChatColor.AQUA + "[AxiomAdvancedTest] " + ChatColor.RESET + message);
        } catch (ignored) {
        }
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

    function volume(min, max) {
        return (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
    }

    function findOnlinePlayer() {
        var iterator = Bukkit.getOnlinePlayers().iterator();
        return iterator.hasNext() ? iterator.next() : null;
    }

    function resolvePlayer(sender) {
        if (sender instanceof Player) {
            return sender;
        }
        return findOnlinePlayer();
    }

    function buildBlockState(blockString) {
        var blockData = Bukkit.createBlockData(blockString);
        try {
            return blockData.getState();
        } catch (e) {
            return CraftBlockData.class.cast(blockData).getState();
        }
    }

    function forEachQuartCell(min, max, callback) {
        var seen = {};
        for (var x = min[0]; x <= max[0]; x++) {
            for (var y = min[1]; y <= max[1]; y++) {
                for (var z = min[2]; z <= max[2]; z++) {
                    var qx = x >> 2;
                    var qy = y >> 2;
                    var qz = z >> 2;
                    var key = qx + "," + qy + "," + qz;
                    if (seen[key]) {
                        continue;
                    }
                    seen[key] = true;
                    callback(qx, qy, qz);
                }
            }
        }
    }

    function buildBiomeBuffer(min, max, biomeKey) {
        var buffer = new BiomeBuffer();
        forEachQuartCell(min, max, function (qx, qy, qz) {
            buffer.set(qx, qy, qz, biomeKey);
        });
        return buffer;
    }

    function captureOriginalBiomes(serverLevel, min, max) {
        var originals = {};
        forEachQuartCell(min, max, function (qx, qy, qz) {
            var holder = serverLevel.getNoiseBiome(qx, qy, qz);
            originals[qx + "," + qy + "," + qz] = holder.unwrapKey().get();
        });
        return originals;
    }

    function buildBiomeBufferFromMap(originals) {
        var buffer = new BiomeBuffer();
        for (var key in originals) {
            var parts = key.split(",");
            buffer.set(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), originals[key]);
        }
        return buffer;
    }

    // 模拟 Axiom 客户端的群系绘制数据包，直接调用 AxiomPaper 的 SetBlockBufferPacketListener。
    function sendBiomePacket(player, serverLevel, biomeBuffer, dispatchSends) {
        var buf = new RegistryFriendlyByteBuf(Unpooled.buffer(), serverLevel.registryAccess());
        buf.writeResourceKey(serverLevel.dimension());
        buf.writeUUID(player.getUniqueId());
        buf.writeByte(1);
        biomeBuffer.save(buf);
        buf.writeVarInt(dispatchSends);
        new SetBlockBufferPacketListener(AxiomPaper.PLUGIN).onReceive(player, buf);
        buf.release();
    }

    function runBiome(sender, args) {
        if (args.length < 8) {
            send(sender, ChatColor.RED + "用法: /axiomadv biome <x1> <y1> <z1> <x2> <y2> <z2> <biomeId>");
            return;
        }
        var coords = parseCoordinates(args, 1, 6);
        if (coords === null) {
            send(sender, ChatColor.RED + "坐标必须是整数。");
            return;
        }
        var biomeId = String(args[7]);
        var min = [Math.min(coords[0], coords[3]), Math.min(coords[1], coords[4]), Math.min(coords[2], coords[5])];
        var max = [Math.max(coords[0], coords[3]), Math.max(coords[1], coords[4]), Math.max(coords[2], coords[5])];
        if (volume(min, max) > MAX_VOLUME) {
            send(sender, ChatColor.RED + "体积超过测试上限 " + MAX_VOLUME + "。");
            return;
        }

        var player = resolvePlayer(sender);
        if (player === null) {
            send(sender, ChatColor.RED + "群系绘制测试需要至少一个在线玩家作为 Axiom 握手 / executor。");
            return;
        }
        var serverPlayer = CraftPlayer.class.cast(player).getHandle();
        var serverLevel = serverPlayer.level();

        var biomeKey;
        try {
            biomeKey = ResourceKey.create(Registries.BIOME, ResourceLocation.parse(biomeId));
        } catch (e) {
            send(sender, ChatColor.RED + "群系 ID 解析失败: " + e);
            return;
        }

        var originals = captureOriginalBiomes(serverLevel, min, max);
        var paintBuffer = buildBiomeBuffer(min, max, biomeKey);

        var uuid = player.getUniqueId();
        var wasOp = player.isOp();
        var addedActive = false;
        if (!wasOp) {
            player.setOp(true);
        }
        if (!AxiomPaper.PLUGIN.activeAxiomPlayers.contains(uuid)) {
            AxiomPaper.PLUGIN.activeAxiomPlayers.add(uuid);
            addedActive = true;
        }

        try {
            sendBiomePacket(player, serverLevel, paintBuffer, 1024);
            logInfo("已提交群系绘制包: biome=" + biomeId + " 范围=[" + min.join(",") + "]->[" + max.join(",") + "] cells=" + paintBuffer.getSectionCount() + " executor=" + player.getName());
        } catch (e) {
            logError("群系绘制包发送失败: " + e);
            if (addedActive) {
                AxiomPaper.PLUGIN.activeAxiomPlayers.remove(uuid);
            }
            if (!wasOp) {
                player.setOp(false);
            }
            return;
        }

        send(sender, "已提交群系绘制，验证后会自动恢复原始群系。");
        var attempts = 0;
        var sampleX = min[0];
        var sampleY = min[1];
        var sampleZ = min[2];
        var taskId = task.repeat(ticks(1), ticks(1), function () {
            attempts++;
            var current = serverLevel.getNoiseBiome(sampleX >> 2, sampleY >> 2, sampleZ >> 2).unwrapKey().get();
            if (current.equals(biomeKey) || attempts >= VERIFY_MAX_ATTEMPTS) {
                task.cancel(taskId);
                logInfo("群系绘制验证: (" + sampleX + "," + sampleY + "," + sampleZ + ") 实际=" + current.location() + " 期望=" + biomeKey.location() + " 轮询=" + attempts + " tick");

                try {
                    var restoreBuffer = buildBiomeBufferFromMap(originals);
                    sendBiomePacket(player, serverLevel, restoreBuffer, 1024);
                    logInfo("已提交原始群系恢复: cells=" + restoreBuffer.getSectionCount());
                } catch (e2) {
                    logError("群系恢复失败: " + e2);
                }

                if (addedActive) {
                    AxiomPaper.PLUGIN.activeAxiomPlayers.remove(uuid);
                }
                if (!wasOp) {
                    player.setOp(false);
                }

                var restoreTaskId = task.repeat(ticks(2), ticks(2), function () {
                    var restored = serverLevel.getNoiseBiome(sampleX >> 2, sampleY >> 2, sampleZ >> 2).unwrapKey().get();
                    logInfo("群系恢复验证: (" + sampleX + "," + sampleY + "," + sampleZ + ") 实际=" + restored.location());
                    task.cancel(restoreTaskId);
                });
            }
        });
    }

    function runBlueprint(sender, args) {
        var origin = parseCoordinates(args, 1, 3);
        if (origin === null) {
            send(sender, ChatColor.RED + "用法: /axiomadv bp <x> <y> <z>");
            return;
        }
        var player = resolvePlayer(sender);
        if (player === null) {
            send(sender, ChatColor.RED + "蓝图放置测试需要至少一个在线玩家作为 executor。");
            return;
        }

        // 1) 用 BlockBuffer 构造一个 5x5 测试图案（stone / gold 棋盘 + 中心 diamond）。
        var source = new BlockBuffer(Block.BLOCK_STATE_REGISTRY);
        var stone = buildBlockState("minecraft:stone");
        var gold = buildBlockState("minecraft:gold_block");
        var diamond = buildBlockState("minecraft:diamond_block");
        var blockCount = 0;
        for (var dx = 0; dx < 5; dx++) {
            for (var dz = 0; dz < 5; dz++) {
                var state = (dx === 2 && dz === 2) ? diamond : (((dx + dz) % 2 === 0) ? stone : gold);
                source.set(dx, 0, dz, state);
                blockCount++;
            }
        }

        // 2) 转换为 RawBlueprint 需要的 section map。
        var blockMap = new Long2ObjectOpenHashMap();
        var sourceIterator = source.entrySet().iterator();
        while (sourceIterator.hasNext()) {
            var sourceEntry = sourceIterator.next();
            blockMap.put(sourceEntry.getLongKey(), sourceEntry.getValue());
        }

        var header = new BlueprintHeader(2, "OpenJS Test Blueprint", "OpenJS", new ArrayList(), 0.0, 0.0, true, blockCount, false);
        var thumbnail = Java.to([], "byte[]");
        var raw = new RawBlueprint(header, thumbnail, blockMap, new Long2ObjectOpenHashMap(), new ArrayList());
        var bpFile = new File(plugin.getDataFolder(), "openjs_advanced_test.bp");

        var loaded;
        try {
            var fileOut = new FileOutputStream(bpFile);
            BlueprintIo.writeRaw(fileOut, raw);
            fileOut.close();
            var fileIn = new FileInputStream(bpFile);
            loaded = BlueprintIo.readRawBlueprint(fileIn);
            fileIn.close();
            logInfo("蓝图读写成功: name=" + loaded.header().name() + " sections=" + loaded.blocks().size() + " fileSize=" + bpFile.length() + " bytes");
        } catch (e) {
            logError("蓝图读写失败: " + e);
            send(sender, ChatColor.RED + "蓝图读写失败，详见控制台。");
            return;
        }

        // 3) 把读回的 blueprint section 数据送入 BlockBuffer / SetBlockBufferOperation 放置。
        var placeBuffer = new BlockBuffer(Block.BLOCK_STATE_REGISTRY);
        var placed = 0;
        var sectionIterator = loaded.blocks().long2ObjectEntrySet().iterator();
        while (sectionIterator.hasNext()) {
            var sectionEntry = sectionIterator.next();
            var sectionKey = sectionEntry.getLongKey();
            var cx = BlockPos.getX(sectionKey);
            var cy = BlockPos.getY(sectionKey);
            var cz = BlockPos.getZ(sectionKey);
            var container = sectionEntry.getValue();
            for (var lx = 0; lx < 16; lx++) {
                for (var ly = 0; ly < 16; ly++) {
                    for (var lz = 0; lz < 16; lz++) {
                        var blockState = container.get(lx, ly, lz);
                        if (BlockBuffer.EMPTY_STATE.equals(blockState)) {
                            continue;
                        }
                        placeBuffer.set(origin[0] + cx * 16 + lx, origin[1] + cy * 16 + ly, origin[2] + cz * 16 + lz, blockState);
                        placed++;
                    }
                }
            }
        }

        var serverPlayer = CraftPlayer.class.cast(player).getHandle();
        var operation = new SetBlockBufferOperation(serverPlayer, placeBuffer, false);
        AxiomPaper.PLUGIN.addPendingOperation(serverPlayer.level(), operation);
        logInfo("蓝图放置已提交: origin=[" + origin.join(",") + "] placed=" + placed + " sections=" + placeBuffer.getSectionCount() + " executor=" + player.getName());
        send(sender, "蓝图已生成、读回并提交放置。");

        var attempts = 0;
        var centerX = origin[0] + 2;
        var centerY = origin[1];
        var centerZ = origin[2] + 2;
        var taskId = task.repeat(ticks(1), ticks(1), function () {
            attempts++;
            var actual = player.getWorld().getBlockData(centerX, centerY, centerZ).getAsString();
            if (actual === "minecraft:diamond_block" || attempts >= VERIFY_MAX_ATTEMPTS) {
                task.cancel(taskId);
                logInfo("蓝图放置验证: (" + centerX + "," + centerY + "," + centerZ + ") 实际=" + actual + " 期望=minecraft:diamond_block 轮询=" + attempts + " tick");
            }
        });
        bpFile.delete();
    }

    function showHelp(sender) {
        send(sender, ChatColor.YELLOW + "/axiomadv biome <x1> <y1> <z1> <x2> <y2> <z2> <biomeId>");
        send(sender, ChatColor.YELLOW + "/axiomadv bp <x> <y> <z>");
    }

    addCommand("axiomadv", {
        onCommand: function (sender, javaArgs) {
            var args = toArray(javaArgs);
            var sub = args.length > 0 ? String(args[0]).toLowerCase() : "help";
            try {
                if (sub === "biome") {
                    runBiome(sender, args);
                } else if (sub === "bp") {
                    runBlueprint(sender, args);
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

    logInfo("高级测试脚本已加载。使用 /axiomadv help 查看命令。");
})();
