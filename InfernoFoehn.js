/*
 * InfernoFoehn.js —— 自定义 BOSS「炎狱焚风」（OpenJS 1.5.0）
 *
 * 获取方式：/call boss 炎狱焚风
 * 召唤方式：手持“召唤炎狱焚风”烈焰棒，右键点击地面（6 秒倒计时后降临）
 *
 * 怪物数据：
 *   - 生命值 999
 *   - 免疫火焰、岩浆、爆炸伤害
 *   - 低空飞行，移动速度与玩家步行相当
 *   - 外观：旋转的 2×2×2 岩浆块 + 环绕火焰 + 巨型火龙卷（半血后变蓝）
 *   - 碰撞：Husk（寻路 / 移动 / 主生命值）+ 全程浮空隐形 Slime size4（2.08×2.08 碰撞箱）
 *     两层碰撞箱重叠；命中任意一个都会通过计分板同步到同一份 BOSS 生命值
 *   - 困难模式：/call boss 炎狱焚风-hard。HP=300+400×附近玩家数（>10 按 10 计），
 *     火种=玩家数×4 并在 64 格随机分布、12 秒窗口；多目标火球/连续冲撞/全玩家吸附激光/
 *     10 次远程硬直/15 护甲 10 韧性/末影水晶凋零等强化机制；战斗聊天提示关闭。
 *   - AllMusic BGM：一阶段循环《霊知の太陽信仰 ～ Nuclear Fusion》（22636637），
 *     半血引燃后循环《Armageddon》（1495879966）；死亡/清理/脚本卸载时停止。
 *
 * 攻击手段：
 *   1. 杀戮光环：6 格内玩家被点燃，每 0.1 秒受到 1 点伤害（会重置受击无敌帧）
 *   2. 大型火焰弹：12 tick 红色粒子激光预警，爆炸威力 4.5
 *   3. 小型火焰弹幕：连续发射 120 枚，爆炸威力 1.75
 *   4. 冲撞：8 tick 黄色粒子预警，直线快速移动 30 格；每次冲撞都是强化冲撞，
 *      命中造成 25 点伤害
 *   5. 生命值低于 450：进入 5 秒剧烈闪烁的“引燃”状态，期间免疫一切伤害，
 *      结束后以自身为中心产生大爆炸（威力 10.0）
 *   6. 死亡：5 秒闪烁期间不间断发射爆炸威力 2.75 的小火球，
 *      随后产生更强的爆炸（威力 13.0）
 *   7. 远程硬直：累计 6 次远程命中后，杀戮光环消失 5 秒；期间 BOSS 无法移动、
 *      无法冲撞和发射大型火球，且受到近战伤害 ×1.5
 *   8. 半血后强化：大小火球威力 +0.5 并改用末影龙紫色龙息弹贴图；
 *      远程硬直结束时发动超级强化冲撞（45 格、35 伤害），冲撞结束才发射水晶火球
 *   9. 半血后吸附激光：锁定最远敌人，持续 30 秒；被吸附者可用末影珍珠脱离，
 *      未脱离时受到的杀戮光环伤害 ×2
 *  10. 火焰龙卷风：多层随机螺旋曲线 + 底部火环，半血后变蓝色火焰粒子
 *  11. HP 归零：进入无敌煤炭块状态并停止旋转，在东南西北 30 格召唤火种
 *      （20 HP、岩浆块贴图、无 AI、免疫火焰/爆炸、永久发光标记）；
 *      20 秒后火种化作贝塞尔火焰漩涡回归，BOSS 恢复“剩余火种 ×100”HP。
 *      清除全部火种会立刻进入死亡自爆；剩余火种数量会保留到下一次 HP 归零。
 */

// InfernoFoehn IIFE 包装
// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见仓库根目录《OpenJS脚本数据契约.md》。
(function () {
    "use strict";

    var Material = Java.type("org.bukkit.Material");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Class = Java.type("java.lang.Class");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Location = Java.type("org.bukkit.Location");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var GameMode = Java.type("org.bukkit.GameMode");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var Transformation = Java.type("org.bukkit.util.Transformation");
    var Vector3f = Java.type("org.joml.Vector3f");
    var Quaternionf = Java.type("org.joml.Quaternionf");
    var Color = Java.type("org.bukkit.Color");
    var Billboard = Java.type("org.bukkit.entity.Display$Billboard");
    var Brightness = Java.type("org.bukkit.entity.Display$Brightness");
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var PlayerClass = Java.type("org.bukkit.entity.Player");

    var HuskClass = Class.forName("org.bukkit.entity.Husk");
    var SlimeClass = Class.forName("org.bukkit.entity.Slime");
    var BlockDisplayClass = Class.forName("org.bukkit.entity.BlockDisplay");
    var FireballClass = Class.forName("org.bukkit.entity.Fireball");
    var SmallFireballClass = Class.forName("org.bukkit.entity.SmallFireball");
    var DragonFireballClass = Class.forName("org.bukkit.entity.DragonFireball");
    var EnderCrystalClass = Class.forName("org.bukkit.entity.EnderCrystal");
    var ProjectileClass = Java.type("org.bukkit.entity.Projectile");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var TeleportCause = Java.type("org.bukkit.event.player.PlayerTeleportEvent$TeleportCause");

    // ---------------------------------------------------------------------------
    // 数值配置
    // ---------------------------------------------------------------------------

    var BOSS_ID = "inferno_foehn";
    var BOSS_NAME = "炎狱焚风";

    var MAX_HEALTH = 999.0;
    var PHASE_THRESHOLD = 450.0;

    var WALK_SPEED = 0.215;          // 方块 / tick，约等于玩家步行速度
    var HOVER_FEET = 0.60;           // 载具脚底离地高度
    var DISPLAY_SCALE = 2.0;
    var CARRIER_SCALE = 2.0;
    var CARRIER_BASE_HEIGHT = 1.95;  // Husk 原始身高
    // 显示实体位置 = 碰撞箱中心（水平居中 + 垂直中心），方块模型再以该位置为中心渲染
    var DISPLAY_CENTER_Y = (CARRIER_BASE_HEIGHT * CARRIER_SCALE) / 2.0;
    var SPIN_DEGREES_PER_TICK = 12.0;

    var TARGET_RANGE = 64.0;

    // 杀戮光环：靠近 BOSS 6 格内，每 0.1 秒受到 1 点伤害
    var AURA_RANGE = 6.0;
    var AURA_DAMAGE = 2.0;
    var AURA_INTERVAL_TICKS = 1;     // 0.1 秒 = 2 tick

    // 大型火焰弹：爆炸威力 4.0；半血后变为紫色龙息弹并 +0.5
    var LARGE_FIREBALL_YIELD = 4.7;
    var LARGE_FIREBALL_COOLDOWN = 120;
    var LARGE_FIREBALL_RANGE = 60.0;
    var LARGE_FIREBALL_BREAK_BLOCKS = true;

    // 小型火球雨：每枚爆炸威力 1.5；半血后变为紫色龙息弹并 +0.5
    // 小弹幕数量很大（单次 120 枚），默认不破坏方块以避免把场地炸成大坑；
    // 爆炸仍然按 1.5 的威力对实体造成伤害与击退。如需原版破坏方块可改为 true。
    var SMALL_FIREBALL_YIELD = 1.95;
    var SMALL_FIREBALL_COUNT = 120;
    var SMALL_FIREBALL_PER_TICK = 3;
    var SMALL_FIREBALL_COOLDOWN = 160;
    var SMALL_FIREBALL_RANGE = 48.0;
    var SMALL_FIREBALL_BREAK_BLOCKS = true;
    var PHASE2_FIREBALL_BONUS = 0.7;

    // 冲撞：现在每一次冲撞都视为强化冲撞，命中造成 25 点伤害
    var CHARGE_DAMAGE = 25.0;
    var CHARGE_DISTANCE = 30.0;
    var CHARGE_STEP = 2.0;           // 2 格 / tick，30 格约 0.75 秒
    var CHARGE_TELEGRAPH_TICKS = 8;  // 8 tick 黄色粒子预警
    var CHARGE_COOLDOWN = 220;
    var CHARGE_RANGE = 26.0;
    var CHARGE_HIT_RADIUS = 3.0;
    var CHARGE_VERTICAL_RADIUS = 3.0;
    var CHARGE_MAX_FIRE_BLOCKS = 120;

    // 超级强化冲撞：半血后，远程硬直结束时立即发动
    var SUPER_CHARGE_DAMAGE = 35.0;
    var SUPER_CHARGE_DISTANCE = 45.0;
    var SUPER_CHARGE_STEP = 3.0;     // 3 格 / tick，45 格约 0.75 秒
    var SUPER_CHARGE_TELEGRAPH_TICKS = 8;
    var SUPER_CHARGE_COOLDOWN = 300;
    var SUPER_CHARGE_HIT_RADIUS = 3.5;

    // 超级冲撞附带的水晶火球（末影水晶外观）；在超级冲撞结束时发射
    var SPECIAL_FIREBALL_YIELD = 7.0;
    var SPECIAL_FIREBALL_BREAK_BLOCKS = true;
    var SPECIAL_FIREBALL_EFFECT_RADIUS = 8.0;
    var SPECIAL_FIREBALL_EFFECT_TICKS = 200;   // 5 秒失明 / 缓慢 / 中毒
    var SPECIAL_FIREBALL_NAUSEA_TICKS = 800;   // 30 秒恶心
    var SPECIAL_FIREBALL_SPEED = 0.9;          // 格 / tick
    var SPECIAL_FIREBALL_LIFE = 80;

    // 大型火焰弹红色粒子预警
    var LARGE_FIREBALL_WARNING_TICKS = 12;
    var WARNING_RED_DUST = new DustOptions(Color.fromRGB(255, 40, 40), 1.5);
    var WARNING_YELLOW_DUST = new DustOptions(Color.fromRGB(255, 220, 0), 1.7);

    // 远程硬直：累计 6 次远程命中后触发 5 秒硬直
    var RANGED_HITS_TO_STAGGER = 6;
    var STAGGER_DURATION_TICKS = 100;          // 5 秒
    var STAGGER_MELEE_MULTIPLIER = 1.5;        // 硬直期间受到的近战伤害倍率

    // 吸附激光：半血后锁定最远敌人，持续 30 秒，冷却 30 秒
    var ATTRACT_DURATION_TICKS = 600;          // 30 秒
    var ATTRACT_COOLDOWN_TICKS = 600;          // 30 秒
    var ATTRACT_MAX_RANGE = 64.0;
    var ATTRACT_BREAK_DISTANCE = 96.0;
    var ATTRACT_PULL_SPEED = 0.32;             // 格 / tick
    var ATTRACT_PULL_LIFT = 0.10;              // 向上速度，制造“浮空”效果
    var ATTRACT_AURA_MULTIPLIER = 2.0;         // 被吸附者受到的杀戮光环伤害倍率
    var BOSS_CENTER_Y_OFFSET = 0.9;

    var PHASE_FLASH_TICKS = 100;     // 5 秒
    var PHASE_EXPLOSION_POWER = 15.0; // 半血大爆炸
    var DEATH_FLASH_TICKS = 100;     // 5 秒
    var DEATH_EXPLOSION_POWER = 20.0;// 死亡爆炸
    var DEATH_SMALL_FIREBALL_YIELD = 3; // 死亡前摇期间的小火球

    // 火种阶段（HP 归零后的复活机制）
    var FIRE_SEED_INITIAL_COUNT = 4;
    var FIRE_SEED_MAX_HEALTH = 20.0;
    var FIRE_SEED_DISTANCE = 30.0;
    var FIRE_SEED_PHASE_TICKS = 400;      // 20 秒
    var FIRE_SEED_ANIMATION_TICKS = 100;  // 5 秒动画
    var FIRE_SEED_HEAL_PER_SEED = 100.0;  // 每个剩余火种恢复 100 HP
    var FIRE_SEED_DISPLAY_SCALE = 1.6;

    // ---------------------------------------------------------------------------
    // 困难模式（-hard）
    // ---------------------------------------------------------------------------
    var HARD_BOSS_ID = BOSS_ID + "_hard";
    var HARD_BOSS_NAME = "炎狱焚风-完整";
    var HARD_STICK_NAME = ChatColor.DARK_RED + "[炎狱焚风-困难模式]";
    var HARD_PLAYER_RADIUS = 256.0;
    var HARD_MAX_PLAYERS = 10;
    var HARD_SEED_RADIUS = 64.0;
    var HARD_FIRE_SEED_PHASE_TICKS = 240; // 12 秒
    var HARD_HP_BASE = 300.0;
    var HARD_HP_PER_PLAYER = 400.0;
    var HARD_SEEDS_PER_PLAYER = 4;
    var HARD_VOLLEY_PER_PLAYER = 80;
    var HARD_RANGED_HITS_TO_STAGGER = 10;
    var HARD_ARMOR = 15.0;
    var HARD_ARMOR_TOUGHNESS = 10.0;
    var HARD_ATTRACT_PULL_MULTIPLIER = 3.0;
    var HARD_CHARGE_CHAIN_DELAY_TICKS = 5;
    var HARD_PHASE_FLASH_TICKS = 60;      // 3 秒
    var HARD_PHASE_EXPLOSION_POWER = 18.0;
    var HARD_DEATH_FLASH_TICKS = 160;     // 8 秒
    var HARD_DEATH_EXPLOSION_POWER = 35.0;
    var HARD_DEATH_SMALL_FIREBALL_YIELD = 4.0;
    var HARD_DEATH_FIREBALL_PER_TICK = 9;
    var HARD_SPECIAL_FIREBALL_SPEED_MULT = 2.0;
    var HARD_MOVE_SPEED_MULT = 1.25;
    var HARD_WITHER_TICKS = 300;          // 15 秒

    // ---------------------------------------------------------------------------
    // AllMusic BGM（阶段背景音乐）
    // ---------------------------------------------------------------------------
    // 说明：
    //   - 服务器安装 AllMusic + 客户端安装对应 mod 后，服务端通过 /music 点歌。
    //   - AllMusic 没有单曲循环命令，这里通过反射读取 PlayMusic.nowPlayMusic / playList，
    //     把当前 BGM 对象复制回播放队列，实现无缝单曲循环。
    //   - 一阶段循环《霊知の太陽信仰 ～ Nuclear Fusion》
    //   - 二阶段（引燃倒计时开始后）循环《Armageddon》
    //   - 战斗结束 / 脚本卸载时停止 BGM，并清掉播放队列里的 BGM 缓存。
    var BGM_ENABLED = true;
    var BGM_API = "netapi";
    var BGM_PHASE1_ID = "22636637";     // 霊知の太陽信仰 ～ Nuclear Fusion（上海アリス幻樂団）
    var BGM_PHASE2_ID = "1495879966";   // Armageddon（LeaF）
    var BGM_REFRESH_TICKS = 10;         // 0.5 秒检查一次
    var BGM_ADD_RETRY_TICKS = 100;      // 添加失败时 5 秒重试
    var BGM_PLAYER_RADIUS = 256.0;      // 附近无玩家 / 区块未加载时停止 BGM

    // 混合载具：Husk 负责寻路/移动，Slime(size 4) 负责全程浮空的碰撞箱
    var HYBRID_SLIME_SIZE = 4;
    var HYBRID_SLIME_HEIGHT = 0.52 * HYBRID_SLIME_SIZE; // 2.08
    var HYBRID_COLLISION_TAG = "inferno_foehn_collision";
    var SCOREBOARD_OBJECTIVE = "inferno_foehn_hp";
    var SCOREBOARD_TEAM_PREFIX = "ijf_";

    var BOSS_TAG = "inferno_foehn_boss";
    var DISPLAY_TAG = "inferno_foehn_display";
    var PROJECTILE_TAG = "inferno_foehn_projectile";
    var FIRE_SEED_TAG = "inferno_foehn_fire_seed";
    var FIRE_SEED_DISPLAY_TAG = "inferno_foehn_fire_seed_display";
    var BOSS_KEY = new NamespacedKey(plugin, "inferno_foehn_boss_type");
    var DISPLAY_OWNER_KEY = new NamespacedKey(plugin, "inferno_foehn_display_owner");
    var FIRE_SEED_KEY = new NamespacedKey(plugin, "inferno_foehn_fire_seed_owner");
    var FIRE_SEED_DISPLAY_OWNER_KEY = new NamespacedKey(plugin, "inferno_foehn_fire_seed_display_owner");
    var HYBRID_OWNER_KEY = new NamespacedKey(plugin, "inferno_foehn_hybrid_owner");

    var MAGMA_DATA = Material.MAGMA_BLOCK.createBlockData();
    var FLASH_DATA = Material.SHROOMLIGHT.createBlockData();
    var COAL_DATA = Material.COAL_BLOCK.createBlockData();

    // ---------------------------------------------------------------------------
    // 运行时状态
    // ---------------------------------------------------------------------------

    var activeBosses = {};       // uuid -> boss state
    var trackedProjectiles = {}; // uuid -> { proj, life }
    var activeFireSeeds = {};    // seed uuid -> { carrier, display, bossUuid, index }
    var syncDelayedTasks = [];   // 由主循环统一在主线程执行的延迟任务
    var globalTick = 0;
    var lastRegistryApi = null;

    // AllMusic BGM 运行时状态
    var allMusicRefs = null;        // { playMusicClass, nowField, listField, musicApisField }
    var allMusicUnavailable = false;
    var allMusicApiCache = null;    // { api, playUrlMethod }
    var bgmActivePhase = 0;         // 0=未播放 / 1=一阶段 / 2=二阶段
    var bgmP1LastAddTick = -10000;
    var bgmP2LastAddTick = -10000;
    var bgmP1UrlLoading = false;
    var bgmP2UrlLoading = false;
    var bgmP1UrlFailed = false;
    var bgmP2UrlFailed = false;
    var bgmShuttingDown = false;

    // ---------------------------------------------------------------------------
    // 工具函数
    // ---------------------------------------------------------------------------

    function clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    // ---------------------------------------------------------------------------
    // AllMusic BGM 控制
    // ---------------------------------------------------------------------------
    // AllMusic 对插件类做了独立类加载器隔离，OpenJS 无法直接 Java.type 其内部类；
    // 这里通过 Bukkit 插件实例的类加载器 + 反射拿到 PlayMusic.nowPlayMusic / playList，
    // 再用控制台执行 /music 点歌。这样既能精确无缝循环，也不需要解析 AllMusic 的聊天输出。
    function resolveAllMusicRefs() {
        if (!BGM_ENABLED) return null;
        if (allMusicRefs) return allMusicRefs;
        if (allMusicUnavailable) return null;
        try {
            var pluginManager = Bukkit.getPluginManager();
            var musicPlugin = pluginManager.getPlugin("AllMusic");
            if (musicPlugin == null) musicPlugin = pluginManager.getPlugin("allmusic");
            if (musicPlugin == null || !musicPlugin.isEnabled()) {
                allMusicUnavailable = true;
                log.warn("InfernoFoehn 未找到已启用的 AllMusic，BGM 功能已关闭。");
                return null;
            }
            var loader = musicPlugin.getClass().getClassLoader();
            var playMusicClass = loader.loadClass("com.coloryr.allmusic.server.core.music.PlayMusic");
            var allMusicClass = loader.loadClass("com.coloryr.allmusic.server.core.AllMusic");
            var nowField = playMusicClass.getField("nowPlayMusic");
            var listField = playMusicClass.getDeclaredField("playList");
            listField.setAccessible(true);
            var musicApisField = allMusicClass.getField("MUSIC_APIS");
            allMusicRefs = {
                playMusicClass: playMusicClass,
                nowField: nowField,
                listField: listField,
                musicApisField: musicApisField
            };
            allMusicApiCache = null;
            log.info("InfernoFoehn 已连接 AllMusic BGM（" + musicPlugin.getName() + "）。");
            return allMusicRefs;
        } catch (e) {
            allMusicUnavailable = true;
            log.warn("InfernoFoehn 连接 AllMusic 失败，BGM 功能已关闭：" + e);
            return null;
        }
    }

    function getBgmQueue() {
        if (!allMusicRefs) return null;
        try {
            return allMusicRefs.listField.get(null);
        } catch (e) {
            return null;
        }
    }

    function getBgmCurrent() {
        if (!allMusicRefs) return null;
        try {
            return allMusicRefs.nowField.get(null);
        } catch (e) {
            return null;
        }
    }

    function songId(song) {
        if (song == null) return "";
        try {
            return String(song.getClass().getMethod("getId").invoke(song));
        } catch (e) {
            return "";
        }
    }

    function songApi(song) {
        if (song == null) return "";
        try {
            return String(song.getClass().getMethod("getApi").invoke(song));
        } catch (e) {
            return "";
        }
    }

    function isBgmSong(song) {
        var id = songId(song);
        return (id === BGM_PHASE1_ID || id === BGM_PHASE2_ID) && songApi(song) === BGM_API;
    }

    // 预解析 BGM 的真实播放链接。AllMusic 默认在歌曲真正开始时才调用 getPlayUrl + getLyric，
    // 其中歌词接口可能阻塞数十秒，导致切歌出现长时间静音。这里在上一阶段播放期间
    // 提前把 playerUrl 写入 SongInfoObj，AllMusic 播放时会直接使用该链接并跳过歌词请求。
    function getMusicApiRuntime() {
        if (allMusicApiCache) return allMusicApiCache;
        if (!allMusicRefs) return null;
        try {
            var apis = allMusicRefs.musicApisField.get(null);
            var api = apis.get(BGM_API);
            if (api == null) return null;
            var methods = api.getClass().getMethods();
            var playUrlMethod = null;
            for (var i = 0; i < methods.length; i++) {
                if (methods[i].getName() === "getPlayUrl" && methods[i].getParameterCount() === 1) {
                    playUrlMethod = methods[i];
                    break;
                }
            }
            if (playUrlMethod == null) return null;
            allMusicApiCache = { api: api, playUrlMethod: playUrlMethod };
            return allMusicApiCache;
        } catch (e) {
            return null;
        }
    }

    function songPlayerUrl(song) {
        if (song == null) return "";
        try {
            var value = song.getClass().getMethod("getPlayerUrl").invoke(song);
            return value == null ? "" : String(value);
        } catch (e) {
            return "";
        }
    }

    function isBgmUrlReady(song) {
        var url = songPlayerUrl(song);
        return url.length > 0 && url !== "null";
    }

    function setSongPlayerUrl(song, url) {
        try {
            var field = song.getClass().getDeclaredField("playerUrl");
            field.setAccessible(true);
            field.set(song, url);
            return true;
        } catch (e) {
            return false;
        }
    }

    function preloadBgmUrl(song, phase) {
        var ok = false;
        try {
            if (bgmShuttingDown) return;
            if (song != null && !isBgmUrlReady(song)) {
                var apiInfo = getMusicApiRuntime();
                if (apiInfo != null) {
                    var url = apiInfo.playUrlMethod.invoke(apiInfo.api, songId(song));
                    if (url != null) {
                        var urlText = String(url);
                        if (urlText.length > 0 && urlText !== "null") {
                            ok = setSongPlayerUrl(song, urlText);
                            if (ok) {
                                log.info("InfernoFoehn BGM 预加载完成：phase=" + phase
                                        + " id=" + songId(song));
                            }
                        }
                    }
                }
            } else if (song != null) {
                ok = true;
            }
        } catch (e) {
            log.warn("InfernoFoehn BGM 预加载异常：phase=" + phase + " " + e);
        } finally {
            if (phase === 1) {
                bgmP1UrlLoading = false;
                bgmP1UrlFailed = !ok;
            } else {
                bgmP2UrlLoading = false;
                bgmP2UrlFailed = !ok;
            }
        }
    }

    function ensureBgmUrlPreloaded(song, phase) {
        if (song == null) return;
        if (isBgmUrlReady(song)) {
            if (phase === 1) {
                bgmP1UrlLoading = false;
                bgmP1UrlFailed = false;
            } else {
                bgmP2UrlLoading = false;
                bgmP2UrlFailed = false;
            }
            return;
        }
        if ((phase === 1 && bgmP1UrlLoading) || (phase === 2 && bgmP2UrlLoading)) return;
        if (phase === 1) {
            bgmP1UrlLoading = true;
        } else {
            bgmP2UrlLoading = true;
        }
        try {
            task.thread(function () {
                preloadBgmUrl(song, phase);
            });
        } catch (e) {
            if (phase === 1) {
                bgmP1UrlLoading = false;
            } else {
                bgmP2UrlLoading = false;
            }
        }
    }

    function findQueuedBgm(id) {
        var list = getBgmQueue();
        if (!list) return null;
        try {
            for (var i = 0; i < list.size(); i++) {
                var song = list.get(i);
                if (songId(song) === id && songApi(song) === BGM_API) {
                    return song;
                }
            }
        } catch (e) { }
        return null;
    }

    function removeQueuedBgm(id) {
        var list = getBgmQueue();
        if (!list) return 0;
        var removed = 0;
        try {
            for (var i = list.size() - 1; i >= 0; i--) {
                var song = list.get(i);
                if (songId(song) === id && songApi(song) === BGM_API) {
                    list.remove(i);
                    removed++;
                }
            }
        } catch (e) { }
        return removed;
    }

    function moveQueuedBgmToFront(song) {
        var list = getBgmQueue();
        if (!list || song == null) return false;
        try {
            list.remove(song);
            list.add(0, song);
            return true;
        } catch (e) {
            return false;
        }
    }

    // 让当前歌曲在队列里始终保留且只保留一份副本；AllMusic 播放到队首副本时即可无缝续播。
    function ensureBgmLoopCopy(current, id) {
        var list = getBgmQueue();
        if (!list || current == null) return;
        try {
            var kept = null;
            for (var i = list.size() - 1; i >= 0; i--) {
                var song = list.get(i);
                if (songId(song) === id && songApi(song) === BGM_API) {
                    if (kept == null) {
                        kept = song;
                    } else {
                        list.remove(i);
                    }
                }
            }
            if (kept != null) {
                list.remove(kept);
            }
            list.add(0, current);
        } catch (e) {
            log.warn("InfernoFoehn 维护 BGM 循环队列失败：" + e);
        }
    }

    function allMusicCommand(command) {
        try {
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "music " + command);
        } catch (e) {
            log.warn("InfernoFoehn 执行 AllMusic 指令失败（music " + command + "）：" + e);
        }
    }

    // 通过 AllMusic 异步解析歌曲并加入队列；解析需要访问网易云 API，通常需要数秒。
    function requestBgmAdd(phase) {
        var id = phase === 1 ? BGM_PHASE1_ID : BGM_PHASE2_ID;
        var lastTick = phase === 1 ? bgmP1LastAddTick : bgmP2LastAddTick;
        if (globalTick - lastTick < BGM_ADD_RETRY_TICKS) return;
        if (phase === 1) {
            bgmP1LastAddTick = globalTick;
        } else {
            bgmP2LastAddTick = globalTick;
        }
        if (Bukkit.getOnlinePlayers().isEmpty()) return;
        allMusicCommand(BGM_API + " " + id);
    }

    // BGM 只在 BOSS 所在区块已加载、且附近有玩家（256 格内）时维持；
    // 避免玩家离开后全服 BGM 无限循环。
    function isBossBgmAudible(boss) {
        try {
            if (!boss || !boss.carrier || !boss.carrier.isValid()) return false;
            var location = boss.carrier.getLocation();
            if (!boss.world.isChunkLoaded(location.getBlockX() >> 4, location.getBlockZ() >> 4)) {
                return false;
            }
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (player && player.isOnline() && !player.isDead()
                        && player.getLocation().distanceSquared(location)
                        <= BGM_PLAYER_RADIUS * BGM_PLAYER_RADIUS) {
                    return true;
                }
            }
        } catch (e) { }
        return false;
    }

    function getDesiredBgmPhase() {
        if (!BGM_ENABLED) return 0;
        var desired = 0;
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (!boss || boss.dead) continue;
            if (!isBossBgmAudible(boss)) continue;
            // 火种阶段 / 火种回归也属于最终阶段，继续沿用二阶段 BGM。
            if (boss.phase2Triggered || boss.fireSeedPhase || boss.fireSeedAnimation) {
                return 2;
            }
            desired = 1;
        }
        return desired;
    }

    function maintainPhase1Bgm() {
        var list = getBgmQueue();
        if (!list) return;
        var current = getBgmCurrent();
        if (isBgmSong(current) && songId(current) === BGM_PHASE1_ID) {
            bgmActivePhase = 1;
            ensureBgmLoopCopy(current, BGM_PHASE1_ID);
            // 提前把二阶段歌解析好放进队列，并预解析播放链接；真正引燃时直接 next。
            var queuedPhase2 = findQueuedBgm(BGM_PHASE2_ID);
            if (queuedPhase2 == null) {
                requestBgmAdd(2);
            } else {
                ensureBgmUrlPreloaded(queuedPhase2, 2);
            }
            return;
        }

        // 当前不是一阶段 BGM：队列里已有就等链接预解析好再切歌，否则请求添加。
        var queued = findQueuedBgm(BGM_PHASE1_ID);
        if (queued == null) {
            bgmP1UrlFailed = false;
            requestBgmAdd(1);
            return;
        }
        ensureBgmUrlPreloaded(queued, 1);
        if (!isBgmUrlReady(queued) && !bgmP1UrlFailed) {
            // 预解析期间保留当前正在播放的音乐，避免出现长时间静音。
            return;
        }
        moveQueuedBgmToFront(queued);
        bgmActivePhase = 1;
        if (current != null) {
            allMusicCommand("next");
        }
    }

    function maintainPhase2Bgm() {
        var list = getBgmQueue();
        if (!list) return;
        var current = getBgmCurrent();
        if (isBgmSong(current) && songId(current) === BGM_PHASE2_ID) {
            bgmActivePhase = 2;
            removeQueuedBgm(BGM_PHASE1_ID);
            ensureBgmLoopCopy(current, BGM_PHASE2_ID);
            return;
        }

        // 当前不是二阶段 BGM：先清掉排队中的一阶段，避免切歌后又回到一阶段。
        removeQueuedBgm(BGM_PHASE1_ID);
        var queued = findQueuedBgm(BGM_PHASE2_ID);
        if (queued == null) {
            // 保留可能正在播放的一阶段 BGM，等二阶段解析好后再 next，避免中间插播空闲歌单。
            bgmP2UrlFailed = false;
            requestBgmAdd(2);
            return;
        }
        ensureBgmUrlPreloaded(queued, 2);
        if (!isBgmUrlReady(queued) && !bgmP2UrlFailed) {
            // 预解析期间继续播放一阶段音乐；不要把队列清空后让空闲歌单插进来。
            return;
        }
        moveQueuedBgmToFront(queued);
        bgmActivePhase = 2;
        if (current != null) {
            allMusicCommand("next");
        }
    }

    function stopBgm() {
        if (!allMusicRefs && !resolveAllMusicRefs()) return;
        removeQueuedBgm(BGM_PHASE1_ID);
        removeQueuedBgm(BGM_PHASE2_ID);
        var current = getBgmCurrent();
        if (isBgmSong(current)) {
            allMusicCommand("next");
        }
        bgmActivePhase = 0;
        bgmP1LastAddTick = -10000;
        bgmP2LastAddTick = -10000;
        bgmP1UrlFailed = false;
        bgmP2UrlFailed = false;
    }

    // 脚本卸载回调在异步线程执行，不能调用 Bukkit.dispatchCommand（Paper AsyncCatcher）。
    // 这里只清队列并直接结束当前 BGM，让 AllMusic 自己接管后续队列。
    function stopBgmForUnload() {
        if (!BGM_ENABLED) return;
        if (!allMusicRefs && !resolveAllMusicRefs()) return;
        removeQueuedBgm(BGM_PHASE1_ID);
        removeQueuedBgm(BGM_PHASE2_ID);
        var current = getBgmCurrent();
        if (isBgmSong(current)) {
            try {
                var lessTimeField = allMusicRefs.playMusicClass.getField("musicLessTime");
                lessTimeField.setLong(null, 10);
            } catch (e) { }
        }
        bgmActivePhase = 0;
    }

    function updateBgm() {
        if (!BGM_ENABLED) return;
        if (globalTick % BGM_REFRESH_TICKS !== 0) return;
        if (!resolveAllMusicRefs()) return;
        var desired = getDesiredBgmPhase();
        if (desired === 0) {
            if (bgmActivePhase !== 0) {
                stopBgm();
            }
            return;
        }
        if (desired === 1) {
            maintainPhase1Bgm();
        } else {
            maintainPhase2Bgm();
        }
    }

    // OpenJS 的 task.delay 内部使用线程池（异步）。涉及 Bukkit 世界/实体的延迟逻辑
    // 统一放进这个队列，由主循环（Bukkit runTaskTimer）在主线程执行。
    function scheduleSync(delayTicks, callback) {
        var delay = Math.max(0, Math.floor(Number(delayTicks) || 0));
        syncDelayedTasks.push({ at: globalTick + delay, fn: callback });
    }

    function processSyncDelayedTasks() {
        if (syncDelayedTasks.length === 0) return;

        var current = syncDelayedTasks;
        var pending = [];
        syncDelayedTasks = pending;
        for (var i = 0; i < current.length; i++) {
            var entry = current[i];
            if (globalTick >= entry.at) {
                try {
                    entry.fn();
                } catch (e) {
                    log.error("InfernoFoehn 延迟任务异常：" + e
                            + (e && e.stack ? "\n" + e.stack : ""));
                }
            } else {
                pending.push(entry);
            }
        }
    }

    function groundSurfaceY(world, x, z) {
        var block = world.getHighestBlockAt(Math.floor(x), Math.floor(z));
        return block.getY() + 1.0;
    }

    // 从参考高度向下寻找可站立表面，避免 BOSS 在洞穴/室内直接飞到屋顶以上。
    function groundSurfaceYNear(world, x, z, referenceY) {
        var blockX = Math.floor(x);
        var blockZ = Math.floor(z);
        var maxHeight = world.getMaxHeight();
        var minHeight = world.getMinHeight();
        var startY = Math.min(maxHeight - 1, Math.floor(referenceY) + 4);
        var endY = Math.max(minHeight, Math.floor(referenceY) - 12);
        for (var y = startY; y >= endY; y--) {
            var block = world.getBlockAt(blockX, y, blockZ);
            if (block.getType().isSolid() && !block.isLiquid()) {
                return y + 1.0;
            }
        }
        // 下方 12 格内没有地面时（洞穴、岩浆海上空等）保持当前高度。
        return referenceY - HOVER_FEET;
    }

    function getOrRegisterAttribute(entity, attribute) {
        var instance = entity.getAttribute(attribute);
        if (instance == null) {
            try { entity.registerAttribute(attribute); } catch (e) { }
            instance = entity.getAttribute(attribute);
        }
        return instance;
    }

    function setDisplayTransform(display, scale, spinDegrees) {
        // BlockDisplay 的模型原点在方块角上。这里把“方块中心”平移到显示实体位置，
        // 使 Axiom/碰撞位置落在岩浆块中心，而不是方块左下角。
        // p' = T + R * (S * p)：要让中心 C 映射到原点，T = -R * (S * C)。
        var radians = (spinDegrees || 0) * Math.PI / 180.0;
        var spin = new Quaternionf().rotationY(radians);
        var cx = scale * 0.5;
        var cy = scale * 0.5;
        var cz = scale * 0.5;
        var rotatedCenter = spin.transform(new Vector3f(cx, cy, cz));
        var translation = new Vector3f(
            -rotatedCenter.x(),
            -rotatedCenter.y(),
            -rotatedCenter.z()
        );
        var transformation = new Transformation(
            translation,
            spin,
            new Vector3f(scale, scale, scale),
            new Quaternionf()
        );
        display.setTransformation(transformation);
    }

    function bossBarTitle(health, boss) {
        var shown = Math.max(0, Math.round(health));
        var name = getBossDisplayName(boss);
        var max = getBossMaxHealth(boss);
        var nameText = boss && boss.hardMode ? "[" + name + "]" : name;
        return ChatColor.DARK_RED + "" + ChatColor.BOLD + nameText + ChatColor.RESET
            + ChatColor.GRAY + "  |  " + ChatColor.WHITE + shown
            + ChatColor.GRAY + " / " + ChatColor.WHITE + Math.round(max);
    }

    function isHard(boss) {
        return !!(boss && boss.hardMode);
    }

    function getBossDisplayName(boss) {
        return boss && boss.displayName ? boss.displayName : BOSS_NAME;
    }

    function getBossMaxHealth(boss) {
        return boss && boss.maxHealth ? boss.maxHealth : MAX_HEALTH;
    }

    function getBossHp(boss) {
        if (!boss) return 0.0;
        if (typeof boss.hp === "number") return boss.hp;
        return boss.maxHealth ? boss.maxHealth : MAX_HEALTH;
    }

    function setBossHp(boss, value) {
        if (!boss) return;
        var max = getBossMaxHealth(boss);
        boss.hp = Math.max(0.0, Math.min(value, max));
        syncBossScoreboard(boss);
    }

    // 计分板生命核心：所有可造成伤害的入口最终都必须调用本函数。
    // 返回 true 表示本次伤害使生命归零并已清空本体原生生命。
    function damageBossByScoreboard(boss, rawAmount) {
        try {
            if (!boss || boss.dead || boss.transitioning
                    || boss.fireSeedPhase || boss.fireSeedAnimation) return false;
            if (!(rawAmount > 0.0)) return false;

            var amount = rawAmount;
            if (isHard(boss) && boss.staggerTicks <= 0) {
                var armor = HARD_ARMOR;
                var toughness = HARD_ARMOR_TOUGHNESS;
                var reduction = Math.min(20.0,
                        Math.max(armor / 5.0, armor - 4.0 * amount / (toughness + 8.0))) / 25.0;
                amount *= (1.0 - reduction);
            }

            var hp = getBossHp(boss) - amount;
            if (hp <= 0.0) {
                boss.hp = 0.0;
                syncBossScoreboard(boss);
                // 计分板归零：清空本体原生生命，让 EntityDeathEvent 进入火种/死亡流程。
                try { boss.carrier.setHealth(0.0); } catch (e) { }
                return true;
            }

            boss.hp = hp;
            syncBossScoreboard(boss);
            try {
                boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_ENDERMAN_HURT, 0.7, 1.2);
            } catch (e) { }
            return false;
        } catch (e) {
            return false;
        }
    }

    function countPlayersNear(world, location, radius) {
        var count = 0;
        try {
            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!p || p.isDead() || !p.isOnline()) continue;
                try { if (p.getGameMode() === GameMode.SPECTATOR) continue; } catch (e) { }
                if (p.getLocation().distanceSquared(location) <= radius * radius) count++;
            }
        } catch (e) { }
        return count;
    }

    function capHardPlayers(count) {
        return count > HARD_MAX_PLAYERS ? HARD_MAX_PLAYERS : count;
    }

    function listHardPlayers(unit, radius) {
        var list = listPlayersNear(unit.world, unit.carrier.getLocation(), radius);
        if (list.length > HARD_MAX_PLAYERS) list = list.slice(0, HARD_MAX_PLAYERS);
        return list;
    }

    function listPlayersNear(world, location, radius) {
        var result = [];
        try {
            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!p || p.isDead() || !p.isOnline()) continue;
                try { if (p.getGameMode() === GameMode.SPECTATOR) continue; } catch (e) { }
                if (p.getLocation().distanceSquared(location) <= radius * radius) result.push(p);
            }
        } catch (e) { }
        return result;
    }

    function getRangedThreshold(boss) {
        return isHard(boss) ? HARD_RANGED_HITS_TO_STAGGER : RANGED_HITS_TO_STAGGER;
    }

    function setBossArmor(boss, active) {
        if (!boss || !boss.hardMode || !boss.carrier) return;
        try {
            var armor = getOrRegisterAttribute(boss.carrier, Attribute.ARMOR);
            if (armor) armor.setBaseValue(active ? HARD_ARMOR : 0.0);
            var toughness = getOrRegisterAttribute(boss.carrier, Attribute.ARMOR_TOUGHNESS);
            if (toughness) toughness.setBaseValue(active ? HARD_ARMOR_TOUGHNESS : 0.0);
        } catch (e) { }
    }

    function getMoveSpeed(boss) {
        return WALK_SPEED * (isHard(boss) ? HARD_MOVE_SPEED_MULT : 1.0);
    }

    function refreshHardChargeTargets(boss) {
        if (!isHard(boss) || !boss || !boss.carrier || !boss.carrier.isValid()) return;
        try {
            var targets = [];
            if (isDouQuQuActive(boss)) {
                var base = boss.carrier.getLocation();
                var candidates = [];
                var it = boss.world.getLivingEntities().iterator();
                while (it.hasNext()) {
                    var entity = it.next();
                    if (!isValidDisorderTarget(boss, entity)) continue;
                    var d = entity.getLocation().distanceSquared(base);
                    if (d > HARD_PLAYER_RADIUS * HARD_PLAYER_RADIUS) continue;
                    candidates.push({ entity: entity, distance: d });
                }
                candidates.sort(function (a, b) { return a.distance - b.distance; });
                for (var c = 0; c < candidates.length && targets.length < HARD_MAX_PLAYERS; c++) {
                    targets.push(candidates[c].entity);
                }
            } else {
                targets = listHardPlayers(boss, HARD_PLAYER_RADIUS);
            }
            var seen = {};
            if (!boss.hardChargeTargets) boss.hardChargeTargets = {};
            for (var i = 0; i < targets.length; i++) {
                var uuid = String(targets[i].getUniqueId().toString());
                seen[uuid] = true;
                if (boss.hardChargeTargets[uuid] === undefined) boss.hardChargeTargets[uuid] = false;
            }
            for (var known in boss.hardChargeTargets) {
                if (!boss.hardChargeTargets.hasOwnProperty(known)) continue;
                if (!seen[known]) delete boss.hardChargeTargets[known];
            }
        } catch (e) { }
    }

    function getNextHardChargeTarget(boss) {
        if (!isHard(boss)) return null;
        refreshHardChargeTargets(boss);
        try {
            for (var uuid in boss.hardChargeTargets) {
                if (!boss.hardChargeTargets.hasOwnProperty(uuid)) continue;
                if (boss.hardChargeTargets[uuid] === true) continue;
                var entity = findEntityByUuid(boss.world, uuid);
                if (entity && !entity.isDead()) return entity;
                boss.hardChargeTargets[uuid] = true;
            }
        } catch (e) { }
        return null;
    }

    function getPhaseFlashTicks(boss) {
        return isHard(boss) ? HARD_PHASE_FLASH_TICKS : PHASE_FLASH_TICKS;
    }

    function getPhaseExplosionPower(boss) {
        return isHard(boss) ? HARD_PHASE_EXPLOSION_POWER : PHASE_EXPLOSION_POWER;
    }

    function getDeathFlashTicks(boss) {
        return isHard(boss) ? HARD_DEATH_FLASH_TICKS : DEATH_FLASH_TICKS;
    }

    function getDeathExplosionPower(boss) {
        return isHard(boss) ? HARD_DEATH_EXPLOSION_POWER : DEATH_EXPLOSION_POWER;
    }

    function getDeathSmallFireballYield(boss) {
        return isHard(boss) ? HARD_DEATH_SMALL_FIREBALL_YIELD : DEATH_SMALL_FIREBALL_YIELD;
    }

    function getDeathFireballPerTick(boss) {
        return isHard(boss) ? HARD_DEATH_FIREBALL_PER_TICK : SMALL_FIREBALL_PER_TICK;
    }

    function forEachJava(collection, callback) {
        if (!collection) return;
        var iterator = collection.iterator();
        while (iterator.hasNext()) {
            callback(iterator.next());
        }
    }

    function getBossByEntity(entity) {
        if (!entity) return null;
        return activeBosses[String(entity.getUniqueId().toString())] || null;
    }

    // 混合碰撞箱：通过 Slime 上的 PDC 找到所属 BOSS
    function getHybridBossByEntity(entity) {
        if (!entity) return null;
        try {
            var pdc = entity.getPersistentDataContainer();
            if (pdc != null && pdc.has(HYBRID_OWNER_KEY, PersistentDataType.STRING)) {
                var owner = pdc.get(HYBRID_OWNER_KEY, PersistentDataType.STRING);
                if (owner != null && activeBosses[String(owner)]) return activeBosses[String(owner)];
            }
        } catch (e) { }
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (boss && boss.slimeCarrier === entity) return boss;
        }
        return null;
    }

    function createBossScoreboard(carrierUuid, slimeUuid, initialHp) {
        try {
            var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
            var objective = scoreboard.getObjective(SCOREBOARD_OBJECTIVE);
            if (objective == null) {
                try {
                    objective = scoreboard.registerNewObjective(SCOREBOARD_OBJECTIVE, "dummy",
                            ChatColor.DARK_RED + BOSS_NAME);
                } catch (e) {
                    objective = scoreboard.getObjective(SCOREBOARD_OBJECTIVE);
                }
            }
            var compact = String(carrierUuid).split("-").join("");
            var shortId = compact.substring(0, Math.min(12, compact.length));
            var scoreKey = "if_" + shortId;
            var teamName = SCOREBOARD_TEAM_PREFIX + shortId;
            var team = scoreboard.getTeam(teamName);
            if (team == null) {
                try { team = scoreboard.registerNewTeam(teamName); }
                catch (e) { team = scoreboard.getTeam(teamName); }
            }
            if (team != null) {
                team.setDisplayName(BOSS_NAME);
                team.setPrefix(ChatColor.DARK_RED + "[" + BOSS_NAME + "] ");
                try { team.addEntry(String(carrierUuid)); } catch (e) { }
                try { team.addEntry(String(slimeUuid)); } catch (e) { }
            }
            if (objective != null) {
                objective.getScore(scoreKey).setScore(Math.round(initialHp != null ? initialHp : MAX_HEALTH));
            }
            return { objective: objective, scoreKey: scoreKey, team: team, scoreboard: scoreboard };
        } catch (e) {
            log.warn("InfernoFoehn 计分板初始化失败：" + e);
            return null;
        }
    }

    function shouldIgnoreDuplicateDamage(boss, sourceEntity) {
        try {
            if (!boss || !sourceEntity) return false;
            var key = String(sourceEntity.getUniqueId().toString());
            if (boss.lastDamageTick === globalTick && boss.lastDamageSource === key) {
                return true;
            }
            boss.lastDamageTick = globalTick;
            boss.lastDamageSource = key;
            return false;
        } catch (e) {
            return false;
        }
    }

    function syncBossScoreboard(boss) {
        try {
            if (!boss || !boss.objective || !boss.scoreKey || !boss.carrier) return;
            var health = (boss.fireSeedPhase || boss.fireSeedAnimation)
                    ? 0.0 : getBossHp(boss);
            boss.objective.getScore(boss.scoreKey).setScore(Math.round(health));
        } catch (e) { }
    }

    function removeBossScoreboard(boss) {
        try {
            if (!boss) return;
            if (boss.team) {
                try { boss.team.removeEntry(String(boss.uuid)); } catch (e) { }
                try {
                    if (boss.slimeCarrier) {
                        boss.team.removeEntry(String(boss.slimeCarrier.getUniqueId().toString()));
                    }
                } catch (e) { }
                try { boss.team.unregister(); } catch (e) { }
            }
            if (boss.objective && boss.scoreKey) {
                try { boss.objective.getScore(boss.scoreKey).setScore(0); } catch (e) { }
                try {
                    var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
                    scoreboard.resetScores(boss.scoreKey);
                } catch (e) { }
            }
        } catch (e) { }
    }

    function cleanupOrphanScoreboard() {
        try {
            var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
            var iterator = scoreboard.getTeams().iterator();
            var toRemove = [];
            while (iterator.hasNext()) {
                var team = iterator.next();
                var teamName = String(team.getName());
                if (teamName.indexOf(SCOREBOARD_TEAM_PREFIX) !== 0) continue;
                var live = false;
                for (var uuid in activeBosses) {
                    if (!activeBosses.hasOwnProperty(uuid)) continue;
                    if (activeBosses[uuid] && activeBosses[uuid].team === team) {
                        live = true;
                        break;
                    }
                }
                if (!live) toRemove.push(team);
            }
            for (var i = 0; i < toRemove.length; i++) {
                try { toRemove[i].unregister(); } catch (e) { }
            }
        } catch (e) { }
    }



    // Slime 碰撞箱全程浮空，并跟随 Husk 载具（对齐岩浆块中心）
    function syncHybridCollision(boss) {
        try {
            if (!boss || !boss.carrier || !boss.carrier.isValid()) return;
            if (!boss.slimeCarrier || !boss.slimeCarrier.isValid()) return;
            var base = boss.carrier.getLocation();
            var bob = (boss.fireSeedPhase || boss.fireSeedAnimation)
                    ? 0.0 : Math.sin(globalTick / 16.0) * 0.12;
            var centerY = base.getY() + DISPLAY_CENTER_Y + bob;
            var height = boss.slimeCarrier.getHeight();
            if (height <= 0.0) height = HYBRID_SLIME_HEIGHT;
            boss.slimeCarrier.setGravity(false);
            boss.slimeCarrier.setInvisible(true);
            boss.slimeCarrier.setVelocity(new Vector(0.0, 0.0, 0.0));
            boss.slimeCarrier.teleport(new Location(boss.world,
                    base.getX(), centerY - height / 2.0, base.getZ(),
                    base.getYaw(), base.getPitch()));
        } catch (e) { }
    }

    function recordRangedHit(boss, shooter) {
        try {
            if (!boss || !shooter) return;
            if (boss.staggerTicks <= 0 && !boss.dead && !boss.transitioning
                    && !boss.fireSeedPhase && !boss.fireSeedAnimation) {
                boss.rangedHitCount++;
                var threshold = getRangedThreshold(boss);
                shooter.sendActionBar(ChatColor.GOLD + "远程命中 " + ChatColor.RED
                        + boss.rangedHitCount + ChatColor.GOLD + " / " + threshold);
                if (boss.rangedHitCount >= threshold) {
                    startStagger(boss, shooter);
                }
            }
        } catch (e) { }
    }

    function applyBossHealthDamage(boss, amount) {
        damageBossByScoreboard(boss, amount);
    }

    // 命中 Slime 碰撞箱时，把伤害转给 Husk 主生命值；命中 Husk 时走原有事件逻辑
    function handleHybridCollisionDamage(boss, event) {
        try {
            event.setCancelled(true);
            if (!boss || boss.dead || boss.transitioning
                    || boss.fireSeedPhase || boss.fireSeedAnimation) return;

            var cause = event.getCause();
            if (isFireOrExplosionDamage(cause)) return;

            var source = null;
            try { source = event.getDamageSource(); } catch (e) { }
            var direct = source != null ? source.getDirectEntity() : null;
            var causing = source != null ? source.getCausingEntity() : null;
            var amount = event.getFinalDamage();
            if (amount <= 0.0) return;

            var sourceEntity = causing != null ? causing : direct;
            if (sourceEntity != null && shouldIgnoreDuplicateDamage(boss, sourceEntity)) return;

            // 无差别模式下，其他脚本 BOSS 的载具/投射物也能伤害混合碰撞箱。
            if (isDisorderDamageSource(direct) || isDisorderDamageSource(causing)
                    || isDisorderDamageSource(sourceEntity)) {
                applyBossHealthDamage(boss, amount);
                return;
            }

            if (direct instanceof PlayerClass) {
                if (boss.staggerTicks > 0) amount *= STAGGER_MELEE_MULTIPLIER;
                applyBossHealthDamage(boss, amount);
                return;
            }

            if (direct instanceof ProjectileClass) {
                var shooter = direct.getShooter();
                if (shooter instanceof PlayerClass) {
                    recordRangedHit(boss, shooter);
                    applyBossHealthDamage(boss, amount);
                    return;
                }
            }

            if (causing instanceof PlayerClass) {
                applyBossHealthDamage(boss, amount);
                return;
            }

            // 无差别模式下，任何普通生物、其他脚本 BOSS 或其投射物都能伤害混合碰撞箱。
            if (isDouQuQuActive(boss)) {
                applyBossHealthDamage(boss, amount);
            }
        } catch (e) {
            log.error("InfernoFoehn 混合碰撞箱伤害处理异常：" + e);
        }
    }


    // ---------------------------------------------------------------------------
    // 通用粒子 / 爆炸效果
    // ---------------------------------------------------------------------------

    function spawnExplosionParticles(location, intensity) {
        var base = location.clone();
        var world = base.getWorld();
        var waves = Math.round(8 * intensity);
        if (waves < 4) waves = 4;

        for (var w = 0; w < waves; w++) {
            (function(waveIndex) {
                scheduleSync(waveIndex * 2, function() {
                    try {
                        var radius = 2.0 + waveIndex * 0.75 * intensity;
                        var flameCount = Math.round(180 * intensity);
                        var lavaCount = Math.round(60 * intensity);
                        var soulCount = Math.round(100 * intensity);
                        var smokeCount = Math.round(80 * intensity);
                        var explosionCount = Math.round(30 * intensity);

                        world.spawnParticle(Particle.FLAME, base, flameCount,
                                radius, radius * 0.75, radius, 0.08);
                        world.spawnParticle(Particle.LAVA, base, lavaCount,
                                radius * 0.8, radius * 0.55, radius * 0.8, 0.03);
                        world.spawnParticle(Particle.SOUL_FIRE_FLAME, base, soulCount,
                                radius, radius * 0.7, radius, 0.05);
                        world.spawnParticle(Particle.LARGE_SMOKE, base, smokeCount,
                                radius, radius * 0.7, radius, 0.05);
                        world.spawnParticle(Particle.EXPLOSION, base, explosionCount,
                                radius * 0.7, radius * 0.5, radius * 0.7, 0.02);
                        if (waveIndex % 2 === 0) {
                            world.spawnParticle(Particle.EXPLOSION_EMITTER, base,
                                    Math.max(1, Math.round(4 * intensity)),
                                    radius * 0.5, radius * 0.4, radius * 0.5, 0);
                        }
                    } catch (e) {
                        // 粒子效果失败不应影响 BOSS 逻辑
                    }
                });
            })(w);
        }
    }

    function detonate(location, power, stronger) {
        try {
            var world = location.getWorld();
            spawnExplosionParticles(location, stronger ? 1.8 : 1.0);
            world.createExplosion(location, power, false);
            world.strikeLightningEffect(location);
            if (stronger) {
                world.strikeLightningEffect(location.clone().add(3, 0, 0));
                world.strikeLightningEffect(location.clone().add(-3, 0, -3));
            }
            world.playSound(location, Sound.ENTITY_GENERIC_EXPLODE, 6.0, 0.7);
            world.playSound(location, Sound.ENTITY_DRAGON_FIREBALL_EXPLODE, 6.0, 0.6);
        } catch (e) {
            log.error("InfernoFoehn 爆炸效果异常：" + e);
        }
    }

    // ---------------------------------------------------------------------------
    // 生成 / 清理
    // ---------------------------------------------------------------------------

    function isInfernoSummonStick(item, key) {
        try {
            if (item == null || item.getType() != Material.BLAZE_ROD || !item.hasItemMeta()) return false;
            var meta = item.getItemMeta();
            if (!meta) return false;
            var pdc = meta.getPersistentDataContainer();
            if (!pdc.has(key, PersistentDataType.STRING)) return false;
            var id = String(pdc.get(key, PersistentDataType.STRING));
            return id === BOSS_ID || id === HARD_BOSS_ID;
        } catch (e) {
            return false;
        }
    }

    function consumeInfernoSummonStick(player) {
        try {
            if (!player || !player.isOnline()) return;
            var key = new NamespacedKey(plugin, "call_boss_rod_boss_id");
            var inv = player.getInventory();
            var main = inv.getItemInMainHand();
            if (isInfernoSummonStick(main, key)) {
                if (main.getAmount() <= 1) inv.setItemInMainHand(null);
                else { main.setAmount(main.getAmount() - 1); inv.setItemInMainHand(main); }
                return;
            }
            var off = inv.getItemInOffHand();
            if (isInfernoSummonStick(off, key)) {
                if (off.getAmount() <= 1) inv.setItemInOffHand(null);
                else { off.setAmount(off.getAmount() - 1); inv.setItemInOffHand(off); }
                return;
            }
            var contents = inv.getContents();
            for (var i = 0; i < contents.length; i++) {
                var item = contents[i];
                if (!isInfernoSummonStick(item, key)) continue;
                if (item.getAmount() <= 1) inv.setItem(i, null);
                else item.setAmount(item.getAmount() - 1);
                return;
            }
        } catch (e) { }
    }

    function spawnInfernoFoehn(location, player, hardMode) {
        try {
            if (!location || !location.getWorld()) return false;
            var world = location.getWorld();
            var hard = hardMode === true;
            var hardPlayerCount = hard
                    ? Math.max(1, capHardPlayers(countPlayersNear(world, location, HARD_PLAYER_RADIUS))) : 0;
            var maxHealth = hard
                    ? HARD_HP_BASE + HARD_HP_PER_PLAYER * hardPlayerCount : MAX_HEALTH;
            var displayName = hard ? HARD_BOSS_NAME : BOSS_NAME;

            // CallBoss 已经挑选了一个 3 格高的安全位置，直接在其基础上保持低空悬浮。
            var spawnY = location.getY() + HOVER_FEET;
            var spawnLoc = new Location(world, location.getX(), spawnY, location.getZ(), 0, 0);

            var carrier = world.spawn(spawnLoc, HuskClass);
            if (!carrier) return false;

            carrier.setAI(false);
            carrier.setInvisible(true);
            carrier.setSilent(true);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            try { carrier.setShouldBurnInDay(false); } catch (e) { }
            carrier.setCustomName(ChatColor.DARK_RED + displayName);
            carrier.setCustomNameVisible(false);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.addScoreboardTag(BOSS_TAG);
            carrier.getPersistentDataContainer().set(BOSS_KEY, PersistentDataType.STRING,
                    hard ? HARD_BOSS_ID : BOSS_ID);

            var maxHealthAttribute = getOrRegisterAttribute(carrier, Attribute.MAX_HEALTH);
            if (maxHealthAttribute) maxHealthAttribute.setBaseValue(20.0);
            var scaleAttribute = getOrRegisterAttribute(carrier, Attribute.SCALE);
            if (scaleAttribute) scaleAttribute.setBaseValue(CARRIER_SCALE);
            if (hard) {
                var armorAttr = getOrRegisterAttribute(carrier, Attribute.ARMOR);
                if (armorAttr) armorAttr.setBaseValue(HARD_ARMOR);
                var toughnessAttr = getOrRegisterAttribute(carrier, Attribute.ARMOR_TOUGHNESS);
                if (toughnessAttr) toughnessAttr.setBaseValue(HARD_ARMOR_TOUGHNESS);
            }

            try { carrier.setHealth(20.0); } catch (e) { }

            var displayLoc = spawnLoc.clone().add(0, DISPLAY_CENTER_Y, 0);
            var display = world.spawn(displayLoc, BlockDisplayClass);
            if (!display) {
                carrier.remove();
                return false;
            }

            display.setBlock(MAGMA_DATA);
            setDisplayTransform(display, DISPLAY_SCALE, 0);
            display.setRotation(0, 0);
            display.setInterpolationDuration(2);
            display.setInterpolationDelay(0);
            display.setTeleportDuration(2);
            display.setBillboard(Billboard.FIXED);
            display.setBrightness(new Brightness(15, 15));
            display.setViewRange(1.5);
            display.setShadowRadius(1.0);
            display.setShadowStrength(0.8);
            display.setPersistent(true);
            display.setInvulnerable(true);
            display.setSilent(true);
            display.addScoreboardTag(DISPLAY_TAG);
            display.setGlowColorOverride(Color.ORANGE);

            var uuid = String(carrier.getUniqueId().toString());
            display.getPersistentDataContainer().set(DISPLAY_OWNER_KEY, PersistentDataType.STRING, uuid);

            // 混合碰撞箱：Slime(size 4) 全程浮空，只做碰撞箱；Husk 负责寻路/移动
            var slimeFeetY = spawnLoc.getY() + DISPLAY_CENTER_Y - HYBRID_SLIME_HEIGHT / 2.0;
            var slime = world.spawn(new Location(world, spawnLoc.getX(), slimeFeetY, spawnLoc.getZ(), 0, 0), SlimeClass);
            if (!slime) {
                try { display.remove(); } catch (e) { }
                try { carrier.remove(); } catch (e) { }
                return false;
            }
            slime.setSize(HYBRID_SLIME_SIZE);
            slime.setAI(false);
            slime.setInvisible(true);
            slime.setSilent(true);
            slime.setGravity(false);
            slime.setInvulnerable(false);
            slime.setPersistent(true);
            slime.setRemoveWhenFarAway(false);
            slime.setCanPickupItems(false);
            slime.setCollidable(true);
            slime.setCustomName(ChatColor.DARK_RED + displayName);
            slime.setCustomNameVisible(false);
            slime.setMaximumNoDamageTicks(0);
            slime.setNoDamageTicks(0);
            slime.addScoreboardTag(HYBRID_COLLISION_TAG);
            slime.getPersistentDataContainer().set(HYBRID_OWNER_KEY, PersistentDataType.STRING, uuid);
            var slimeMaxHealth = getOrRegisterAttribute(slime, Attribute.MAX_HEALTH);
            if (slimeMaxHealth) slimeMaxHealth.setBaseValue(20.0);
            try { slime.setHealth(20.0); } catch (e) { }


            var compact = uuid.split("-").join("");
            var barKey = new NamespacedKey(plugin, (BOSS_ID + "_" + compact).toLowerCase());
            try {
                var oldBar = Bukkit.getBossBar(barKey);
                if (oldBar != null) {
                    oldBar.removeAll();
                    Bukkit.removeBossBar(barKey);
                }
            } catch (e) { }

            var bar = Bukkit.createBossBar(barKey,
                    bossBarTitle(maxHealth, { hardMode: hard, displayName: displayName, maxHealth: maxHealth }),
                    BarColor.RED, BarStyle.SOLID);
            if (player) bar.addPlayer(player);

            // 一套计分板：记录 BOSS 共享生命值，并把 Husk / Slime 放进同一个队伍
            var scoreboardInfo = createBossScoreboard(uuid, String(slime.getUniqueId().toString()), maxHealth);

            var boss = {
                id: BOSS_ID,
                modeId: hard ? HARD_BOSS_ID : BOSS_ID,
                hardMode: hard,
                displayName: displayName,
                maxHealth: maxHealth,
                hp: maxHealth,
                hardPlayerCount: hardPlayerCount,
                hardChargeTargets: hard ? {} : null,
                hardChargeSequence: false,
                hardChargeRefreshTick: 0,
                uuid: uuid,
                carrier: carrier,
                slimeCarrier: slime,
                display: display,
                world: world,
                bar: bar,
                barKey: barKey,
                objective: scoreboardInfo ? scoreboardInfo.objective : null,
                scoreKey: scoreboardInfo ? scoreboardInfo.scoreKey : null,
                team: scoreboardInfo ? scoreboardInfo.team : null,
                spin: 0.0,
                lastDamageTick: -1,
                lastDamageSource: null,

                nextLargeFireballTick: globalTick + 80,
                nextVolleyTick: globalTick + 140,
                nextChargeTick: globalTick + 200,

                volleyLeft: 0,
                volleyNextTick: 0,
                charge: null,

                // 大型火焰弹红色激光预警
                largeFireballWarning: null,

                // 远程硬直：6 次远程命中触发，持续 5 秒
                rangedHitCount: 0,
                staggerTicks: 0,

                // 半血后的吸附激光
                attract: null,
                nextAttractTick: globalTick + ATTRACT_COOLDOWN_TICKS,

                // 火种阶段（HP 归零后的复活机制）
                fireSeedCount: hard
                        ? hardPlayerCount * HARD_SEEDS_PER_PLAYER : FIRE_SEED_INITIAL_COUNT,
                fireSeedPhase: false,
                fireSeedPhaseStartTick: 0,
                fireSeedPhaseEndTick: 0,
                fireSeedAnimation: false,
                fireSeedAnimationStartTick: 0,
                fireSeedAnimationEndTick: 0,

                phase2Triggered: false,
                dragonTexture: false,
                pendingPhase: false,
                transitioning: false,
                transitionStartTick: 0,
                transitionEndTick: 0,

                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null
            };

            activeBosses[uuid] = boss;
            syncBossScoreboard(boss);

            world.playSound(spawnLoc, Sound.ENTITY_ENDER_DRAGON_GROWL, 1.5, 0.9);
            world.spawnParticle(Particle.FLAME, spawnLoc, 150, 1.5, 1.2, 1.5, 0.08);
            world.spawnParticle(Particle.LAVA, spawnLoc, 35, 1.2, 1.0, 1.2, 0.03);
            world.spawnParticle(Particle.EXPLOSION_EMITTER, spawnLoc, 2, 0.8, 0.8, 0.8, 0);

            if (player) {
                consumeInfernoSummonStick(player);
                if (!hard) {
                    player.sendMessage(ChatColor.DARK_RED + "§l" + BOSS_NAME + ChatColor.RED + " 已降临！");
                }
            }
            log.info("InfernoFoehn 已生成：" + uuid + " @" + spawnLoc
                    + (hard ? " [hard, players=" + hardPlayerCount + ", hp=" + maxHealth + "]" : ""));
            return true;
        } catch (e) {
            log.error("InfernoFoehn 生成失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    function removeBossBar(boss) {
        try {
            if (!boss || !boss.bar) return;
            boss.bar.removeAll();
            if (boss.barKey) {
                Bukkit.removeBossBar(boss.barKey);
            }
        } catch (e) { }
    }

    function cleanupBoss(boss, uuid) {
        if (boss) {
            unregisterDouQuQuEntities(boss);
            cancelLargeFireballWarning(boss);
            destroyAllFireSeeds(boss);
            removeBossScoreboard(boss);
        }
        removeBossBar(boss);
        try { if (boss.display && boss.display.isValid()) boss.display.remove(); } catch (e) { }
        try { if (boss.slimeCarrier && boss.slimeCarrier.isValid()) boss.slimeCarrier.remove(); } catch (e) { }
        try { if (boss.carrier && boss.carrier.isValid()) boss.carrier.remove(); } catch (e) { }
        delete activeBosses[uuid];
    }

    function cleanupOrphans() {
        try {
            var worlds = Bukkit.getWorlds();
            for (var i = 0; i < worlds.size(); i++) {
                var world = worlds.get(i);
                removeTaggedEntities(world, HuskClass, BOSS_TAG, BOSS_KEY);
                removeTaggedEntities(world, SlimeClass, HYBRID_COLLISION_TAG, HYBRID_OWNER_KEY);
                removeTaggedEntities(world, BlockDisplayClass, DISPLAY_TAG, DISPLAY_OWNER_KEY);
                removeTaggedEntities(world, HuskClass, FIRE_SEED_TAG, FIRE_SEED_KEY);
                removeTaggedEntities(world, BlockDisplayClass, FIRE_SEED_DISPLAY_TAG, FIRE_SEED_DISPLAY_OWNER_KEY);
                removeTaggedEntities(world, FireballClass, PROJECTILE_TAG, null);
                removeTaggedEntities(world, SmallFireballClass, PROJECTILE_TAG, null);
                removeTaggedEntities(world, DragonFireballClass, PROJECTILE_TAG, null);
                removeTaggedEntities(world, EnderCrystalClass, PROJECTILE_TAG, null);
            }
            for (var uuid in activeFireSeeds) {
                if (activeFireSeeds.hasOwnProperty(uuid)) delete activeFireSeeds[uuid];
            }
            cleanupBossBars();
            cleanupOrphanScoreboard();
            log.info("InfernoFoehn 已清理旧的 BOSS 实体 / 血条 / 火种 / 混合碰撞箱。");
        } catch (e) {
            log.error("InfernoFoehn 清理旧 BOSS 时异常：" + e);
        }
    }

    function removeTaggedEntities(world, entityClass, tag, key) {
        try {
            var collection = world.getEntitiesByClass(entityClass);
            var iterator = collection.iterator();
            while (iterator.hasNext()) {
                var entity = iterator.next();
                var shouldRemove = false;
                try {
                    if (entity.getScoreboardTags().contains(tag)) shouldRemove = true;
                } catch (e) { }
                if (!shouldRemove && key != null) {
                    try {
                        if (entity.getPersistentDataContainer().has(key, PersistentDataType.STRING)) {
                            shouldRemove = true;
                        }
                    } catch (e) { }
                }
                if (shouldRemove) {
                    try { entity.remove(); } catch (e) { }
                }
            }
        } catch (e) { }
    }

    function cleanupBossBars() {
        var keys = [];
        try {
            var iterator = Bukkit.getBossBars();
            var pluginNamespace = String(plugin.getName()).toLowerCase();
            while (iterator.hasNext()) {
                var bar = iterator.next();
                if (!bar) continue;

                var shouldRemove = false;
                var barKey = null;

                // 1) 新版 key：inferno_foehn_<uuid>
                // 2) 旧版 key：if_<uuid>（历史遗留）
                try {
                    barKey = bar.getKey();
                    if (barKey != null) {
                        var keyNamespace = String(barKey.getNamespace()).toLowerCase();
                        var keyName = String(barKey.getKey()).toLowerCase();
                        if (keyNamespace === pluginNamespace
                                && (keyName.indexOf(BOSS_ID) === 0 || keyName.indexOf("if_") === 0)) {
                            shouldRemove = true;
                        }
                    }
                } catch (e) { }

                // 3) 兜底：标题含 BOSS 显示名的遗留血条（例如旧版本 800/800 的血条）
                if (!shouldRemove) {
                    try {
                        if (String(bar.getTitle()).indexOf(BOSS_NAME) >= 0) {
                            shouldRemove = true;
                        }
                    } catch (e) { }
                }

                if (shouldRemove) {
                    try { bar.removeAll(); } catch (e) { }
                    if (barKey != null) keys.push(barKey);
                }
            }
        } catch (e) { }

        for (var i = 0; i < keys.length; i++) {
            try { Bukkit.removeBossBar(keys[i]); } catch (e) { }
        }
    }

    // ---------------------------------------------------------------------------
    // 目标 / 移动 / 外观
    // ---------------------------------------------------------------------------

    function isDouQuQuActive(boss) {
        try {
            if (!boss) return false;
            var api = getShared("DouQuQu");
            return !!(api && api.isActive(boss.id));
        } catch (e) { return false; }
    }
    function isDisorderDamageSource(entity) {
        try {
            if (!entity) return false;
            var api = getShared("DouQuQu");
            if (!api) return false;
            if (api.isActiveEntity(entity)) return true;
            if (entity instanceof ProjectileClass) {
                var shooter = entity.getShooter();
                if (shooter != null && api.isActiveEntity(shooter)) return true;
            }
        } catch (e) { }
        return false;
    }

    function registerDouQuQuEntities(boss) {
        try {
            var api = getShared("DouQuQu");
            if (!api || !api.isActive(boss.id)) return;
            if (boss.carrier && boss.carrier.isValid()) api.markEntity(boss.id, boss.carrier);
            if (boss.slimeCarrier && boss.slimeCarrier.isValid()) api.markEntity(boss.id, boss.slimeCarrier);
        } catch (e) { }
    }

    function unregisterDouQuQuEntities(boss) {
        try {
            var api = getShared("DouQuQu");
            if (!api) return;
            if (boss.carrier) api.unmarkEntity(boss.carrier);
            if (boss.slimeCarrier) api.unmarkEntity(boss.slimeCarrier);
        } catch (e) { }
    }

    function isValidDisorderTarget(boss, entity) {
        if (!entity || entity === boss.carrier || entity === boss.slimeCarrier) return false;
        try { if (entity.isDead() || !entity.isValid()) return false; } catch (e) { return false; }
        try {
            var tags = entity.getScoreboardTags();
            if (tags.contains(FIRE_SEED_TAG) || tags.contains(FIRE_SEED_DISPLAY_TAG)
                    || tags.contains(DISPLAY_TAG)) return false;
        } catch (e) { }
        if (entity instanceof PlayerClass) {
            try {
                if (!entity.isOnline() || entity.getGameMode() === GameMode.SPECTATOR) return false;
            } catch (e) { }
        }
        try { if (entity.getType().name() === "ARMOR_STAND") return false; } catch (e) { }
        return true;
    }

    function findNearestDisorderTarget(boss) {
        var best = null;
        var bestDistanceSquared = TARGET_RANGE * TARGET_RANGE;
        try {
            var it = boss.world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (!isValidDisorderTarget(boss, entity)) continue;
                var d = entity.getLocation().distanceSquared(boss.carrier.getLocation());
                if (d < bestDistanceSquared) {
                    bestDistanceSquared = d;
                    best = entity;
                }
            }
        } catch (e) { }
        return best;
    }

    function findFarthestTarget(boss) {
        if (!isDouQuQuActive(boss)) return findFarthestPlayer(boss);
        var best = null;
        var bestDistanceSquared = -1.0;
        try {
            var it = boss.world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (!isValidDisorderTarget(boss, entity)) continue;
                var d = entity.getLocation().distanceSquared(boss.carrier.getLocation());
                if (d > ATTRACT_MAX_RANGE * ATTRACT_MAX_RANGE) continue;
                if (d > bestDistanceSquared) {
                    bestDistanceSquared = d;
                    best = entity;
                }
            }
        } catch (e) { }
        return best;
    }

    function getDamageTargets(boss) {
        var list = [];
        try {
            if (isDouQuQuActive(boss)) {
                var it = boss.world.getLivingEntities().iterator();
                while (it.hasNext()) {
                    var entity = it.next();
                    if (isValidDisorderTarget(boss, entity)) list.push(entity);
                }
            } else {
                var players = boss.world.getPlayers();
                for (var i = 0; i < players.size(); i++) {
                    var p = players.get(i);
                    if (!p || p.isDead() || !p.isOnline()) continue;
                    if (p.getGameMode() === GameMode.SPECTATOR) continue;
                    list.push(p);
                }
            }
        } catch (e) { }
        return list;
    }

    function isTargetOnline(target) {
        try {
            if (!target) return false;
            return target instanceof PlayerClass ? target.isOnline() : target.isValid();
        } catch (e) { return false; }
    }

    function isTargetSpectator(target) {
        try {
            return target instanceof PlayerClass && target.getGameMode() === GameMode.SPECTATOR;
        } catch (e) { return false; }
    }

    function sendTargetMessage(target, message) {
        try { if (target instanceof PlayerClass) target.sendMessage(message); } catch (e) { }
    }

    function sendTargetTitle(target, title, subtitle, fadeIn, stay, fadeOut) {
        try {
            if (target instanceof PlayerClass) target.sendTitle(title, subtitle, fadeIn, stay, fadeOut);
        } catch (e) { }
    }

    function sendTargetActionBar(target, message) {
        try { if (target instanceof PlayerClass) target.sendActionBar(message); } catch (e) { }
    }

    function findEntityByUuid(world, uuid) {
        if (!world || !uuid) return null;
        try {
            var it = world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (String(entity.getUniqueId().toString()) === String(uuid)) return entity;
            }
        } catch (e) { }
        return null;
    }

    function findNearestPlayer(boss) {
        if (isDouQuQuActive(boss)) return findNearestDisorderTarget(boss);
        var best = null;
        var bestDistanceSquared = 1.0e18;
        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead() || !player.isOnline()) continue;
            if (player.getGameMode() == GameMode.SPECTATOR) continue;
            var distanceSquared = player.getLocation().distanceSquared(boss.carrier.getLocation());
            if (distanceSquared < bestDistanceSquared) {
                bestDistanceSquared = distanceSquared;
                best = player;
            }
        }
        if (bestDistanceSquared <= TARGET_RANGE * TARGET_RANGE) return best;
        return null;
    }

    function findFarthestPlayer(boss) {
        var best = null;
        var bestDistanceSquared = -1.0;
        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead() || !player.isOnline()) continue;
            if (player.getGameMode() == GameMode.SPECTATOR) continue;
            var distanceSquared = player.getLocation().distanceSquared(boss.carrier.getLocation());
            if (distanceSquared > ATTRACT_MAX_RANGE * ATTRACT_MAX_RANGE) continue;
            if (distanceSquared > bestDistanceSquared) {
                bestDistanceSquared = distanceSquared;
                best = player;
            }
        }
        return best;
    }

    function findPlayerByUuid(world, uuid) {
        if (!world || !uuid) return null;
        try {
            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (String(player.getUniqueId().toString()) === String(uuid)) return player;
            }
        } catch (e) { }
        return null;
    }

    // ---------------------------------------------------------------------------
    // 预警粒子（大型火焰弹红色 / 冲撞黄色）
    // ---------------------------------------------------------------------------

    function drawDustLaser(world, from, to, dustOptions) {
        try {
            var direction = to.toVector().subtract(from.toVector());
            var distance = direction.length();
            if (distance < 0.01) return;
            direction.normalize();
            var samples = Math.min(90, Math.max(1, Math.ceil(distance / 0.65)));
            for (var i = 0; i <= samples; i++) {
                var t = i / samples;
                var x = from.getX() + direction.getX() * distance * t;
                var y = from.getY() + direction.getY() * distance * t;
                var z = from.getZ() + direction.getZ() * distance * t;
                world.spawnParticle(Particle.DUST, x, y, z, 1, 0.0, 0.0, 0.0, 0.0, dustOptions);
            }
        } catch (e) { }
    }

    function cancelLargeFireballWarning(boss) {
        if (!boss || !boss.largeFireballWarning) return;
        boss.largeFireballWarning = null;
    }

    function startLargeFireballWarning(boss, target) {
        if (!boss || boss.dead || boss.fireSeedPhase || boss.fireSeedAnimation) return;
        if (!target || boss.largeFireballWarning) return;
        var from = boss.carrier.getLocation().clone().add(0, 1.6, 0);
        var targets = [];

        if (isHard(boss)) {
            var players = listHardPlayers(boss, HARD_PLAYER_RADIUS);
            for (var i = 0; i < players.length; i++) {
                var aim = players[i].getEyeLocation().toVector().subtract(from.toVector());
                if (aim.lengthSquared() < 0.001) aim = new Vector(0, 0, 1);
                targets.push({
                    uuid: String(players[i].getUniqueId().toString()),
                    lastDirection: aim.normalize()
                });
            }
            if (targets.length === 0) {
                var fallbackAim = target.getEyeLocation().toVector().subtract(from.toVector());
                if (fallbackAim.lengthSquared() < 0.001) fallbackAim = new Vector(0, 0, 1);
                targets.push({
                    uuid: String(target.getUniqueId().toString()),
                    lastDirection: fallbackAim.normalize()
                });
            }
        } else {
            var singleAim = target.getEyeLocation().toVector().subtract(from.toVector());
            if (singleAim.lengthSquared() < 0.001) singleAim = new Vector(0, 0, 1);
            targets.push({
                uuid: String(target.getUniqueId().toString()),
                lastDirection: singleAim.normalize()
            });
        }

        boss.largeFireballWarning = {
            targets: targets,
            targetUuid: targets[0].uuid,
            endTick: globalTick + LARGE_FIREBALL_WARNING_TICKS,
            lastDirection: targets[0].lastDirection.clone()
        };
        boss.nextLargeFireballTick = boss.largeFireballWarning.endTick + LARGE_FIREBALL_COOLDOWN;
        try {
            boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_BLAZE_SHOOT, 2.0, 1.2);
            boss.world.spawnParticle(Particle.DUST, from, 20, 0.4, 0.4, 0.4, 0.0, WARNING_RED_DUST);
        } catch (e) { }
    }

    function updateLargeFireballWarning(boss) {
        var warning = boss.largeFireballWarning;
        if (!warning) return false;
        try {
            var from = boss.carrier.getLocation().clone().add(0, 1.6, 0);
            var targets = warning.targets;
            if (!targets || targets.length === 0) {
                targets = [{
                    uuid: warning.targetUuid,
                    lastDirection: warning.lastDirection
                }];
                warning.targets = targets;
            }

            for (var i = 0; i < targets.length; i++) {
                var entry = targets[i];
                var target = findEntityByUuid(boss.world, entry.uuid);
                var to = null;
                if (target && isTargetOnline(target) && !target.isDead()) {
                    to = target.getEyeLocation().clone();
                    var aim = to.toVector().subtract(from.toVector());
                    if (aim.lengthSquared() > 0.001) {
                        entry.lastDirection = aim.normalize();
                    }
                } else {
                    to = from.clone().add(entry.lastDirection.clone().multiply(12.0));
                }
                drawDustLaser(boss.world, from, to, WARNING_RED_DUST);
                boss.world.spawnParticle(Particle.DUST, to, 4, 0.15, 0.15, 0.15, 0.0, WARNING_RED_DUST);
            }
            warning.lastDirection = targets[0].lastDirection.clone();

            if (globalTick >= warning.endTick) {
                boss.largeFireballWarning = null;
                for (var k = 0; k < targets.length; k++) {
                    fireLargeFireballDirection(boss, targets[k].lastDirection.clone());
                }
            }
        } catch (e) {
            boss.largeFireballWarning = null;
        }
        return boss.largeFireballWarning != null;
    }

    function drawChargeWarning(boss, charge, location) {
        try {
            var from = location.clone().add(0, 1.0, 0);
            var maxDistance = (charge.maxDistance != null) ? charge.maxDistance : CHARGE_DISTANCE;
            var to = from.clone().add(charge.dir.clone().multiply(Math.min(maxDistance, 26.0)));
            drawDustLaser(boss.world, from, to, WARNING_YELLOW_DUST);
            boss.world.spawnParticle(Particle.DUST, location.getX(), location.getY() + 0.6,
                    location.getZ(), 24, 1.3, 0.6, 1.3, 0.0, WARNING_YELLOW_DUST);
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 火种：生成 / 移除 / 阶段推进
    // ---------------------------------------------------------------------------

    function getFireSeedByEntity(entity) {
        if (!entity) return null;
        return activeFireSeeds[String(entity.getUniqueId().toString())] || null;
    }

    function spawnFireSeedAt(boss, location, index) {
        try {
            var world = boss.world;
            try { world.getChunkAt(location).load(); } catch (e) { }

            var carrier = world.spawn(location, HuskClass);
            if (!carrier) return null;

            carrier.setAI(false);
            carrier.setInvisible(true);
            carrier.setSilent(true);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            try { carrier.setShouldBurnInDay(false); } catch (e) { }
            carrier.setCustomName(ChatColor.GOLD + "火种");
            carrier.setCustomNameVisible(true);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.addScoreboardTag(FIRE_SEED_TAG);
            carrier.getPersistentDataContainer().set(FIRE_SEED_KEY,
                    PersistentDataType.STRING, boss.uuid);
            try { carrier.setGlowing(true); } catch (e) { }

            var maxHealth = getOrRegisterAttribute(carrier, Attribute.MAX_HEALTH);
            if (maxHealth) maxHealth.setBaseValue(FIRE_SEED_MAX_HEALTH);
            try { carrier.setHealth(FIRE_SEED_MAX_HEALTH); } catch (e) { }

            var displayLoc = location.clone().add(0, 0.8, 0);
            var display = world.spawn(displayLoc, BlockDisplayClass);
            if (!display) {
                try { carrier.remove(); } catch (e) { }
                return null;
            }

            display.setBlock(MAGMA_DATA);
            setDisplayTransform(display, FIRE_SEED_DISPLAY_SCALE, 0);
            display.setRotation(0, 0);
            display.setInterpolationDuration(2);
            display.setInterpolationDelay(0);
            display.setTeleportDuration(2);
            display.setBillboard(Billboard.FIXED);
            display.setBrightness(new Brightness(15, 15));
            display.setViewRange(1.5);
            display.setShadowRadius(0.8);
            display.setShadowStrength(0.8);
            display.setPersistent(true);
            display.setInvulnerable(true);
            display.setSilent(true);
            display.addScoreboardTag(FIRE_SEED_DISPLAY_TAG);
            display.getPersistentDataContainer().set(FIRE_SEED_DISPLAY_OWNER_KEY,
                    PersistentDataType.STRING, String(carrier.getUniqueId().toString()));

            activeFireSeeds[String(carrier.getUniqueId().toString())] = {
                uuid: String(carrier.getUniqueId().toString()),
                carrier: carrier,
                display: display,
                bossUuid: boss.uuid,
                index: index,
                spawnTick: globalTick
            };
            return carrier;
        } catch (e) {
            log.error("InfernoFoehn 火种生成失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return null;
        }
    }

    function spawnFireSeedPositions(boss) {
        var base = boss.carrier.getLocation();
        var count = Math.max(0, boss.fireSeedCount | 0);
        if (isHard(boss)) {
            // 困难模式：在半径 64 格内随机分布。
            for (var h = 0; h < count; h++) {
                var angle = Math.random() * Math.PI * 2.0;
                var radius = Math.sqrt(Math.random()) * HARD_SEED_RADIUS;
                var hx = base.getX() + Math.cos(angle) * radius;
                var hz = base.getZ() + Math.sin(angle) * radius;
                var hy = groundSurfaceYNear(boss.world, hx, hz, base.getY()) + 1.0;
                spawnFireSeedAt(boss, new Location(boss.world, hx, hy, hz), h);
            }
            return;
        }
        var offsets = [[FIRE_SEED_DISTANCE, 0], [-FIRE_SEED_DISTANCE, 0],
                [0, FIRE_SEED_DISTANCE], [0, -FIRE_SEED_DISTANCE]];
        count = Math.min(offsets.length, count);
        for (var i = 0; i < count; i++) {
            var x = base.getX() + offsets[i][0];
            var z = base.getZ() + offsets[i][1];
            var y = groundSurfaceYNear(boss.world, x, z, base.getY()) + 1.0;
            spawnFireSeedAt(boss, new Location(boss.world, x, y, z), i);
        }
    }

    function destroyAllFireSeeds(boss) {
        for (var uuid in activeFireSeeds) {
            if (!activeFireSeeds.hasOwnProperty(uuid)) continue;
            var seed = activeFireSeeds[uuid];
            if (boss && seed.bossUuid !== boss.uuid) continue;
            delete activeFireSeeds[uuid];
            try { if (seed.display && seed.display.isValid()) seed.display.remove(); } catch (e) { }
            try { if (seed.carrier && seed.carrier.isValid()) seed.carrier.remove(); } catch (e) { }
        }
    }

    function removeFireSeed(seedUuid, killed) {
        var seed = activeFireSeeds[seedUuid];
        if (!seed) return;
        delete activeFireSeeds[seedUuid];
        try { if (seed.display && seed.display.isValid()) seed.display.remove(); } catch (e) { }
        try { if (seed.carrier && seed.carrier.isValid()) seed.carrier.remove(); } catch (e) { }

        var boss = activeBosses[seed.bossUuid];
        if (!boss || !killed || !boss.fireSeedPhase) return;

        boss.fireSeedCount = Math.max(0, boss.fireSeedCount - 1);
        try {
            boss.bar.setTitle(ChatColor.DARK_RED + BOSS_NAME + ChatColor.GRAY + " | "
                    + ChatColor.YELLOW + "火种阶段 · 剩余 " + boss.fireSeedCount + " 个火种");
        } catch (e) { }

        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (!isHard(boss)
                        && player.getLocation().distanceSquared(boss.carrier.getLocation()) <= 80.0 * 80.0) {
                    player.sendMessage(ChatColor.GOLD + "[炎狱焚风] " + ChatColor.YELLOW
                            + "一个火种被摧毁，剩余 " + boss.fireSeedCount + " 个！");
                }
            }
        } catch (e) { }

        if (boss.fireSeedCount <= 0) {
            finishFireSeedPhase(boss);
        }
    }

    function startFireSeedPhase(boss) {
        if (!boss || boss.dead || boss.fireSeedPhase || boss.fireSeedAnimation) return;
        if (boss.fireSeedCount <= 0) {
            startDeathSequence(boss);
            return;
        }

        boss.fireSeedPhase = true;
        boss.fireSeedPhaseStartTick = globalTick;
        boss.fireSeedPhaseEndTick = globalTick
                + (isHard(boss) ? HARD_FIRE_SEED_PHASE_TICKS : FIRE_SEED_PHASE_TICKS);
        boss.fireSeedAnimation = false;
        // HP 已经归零，视为经历过半血阶段，避免复活后再次触发半血转换。
        boss.phase2Triggered = true;
        boss.dragonTexture = true;
        boss.volleyLeft = 0;
        boss.charge = null;
        boss.staggerTicks = 0;
        boss.rangedHitCount = 0;
        boss.largeFireballWarning = null;
        if (boss.attract) endAttract(boss, false);

        try { boss.carrier.setInvulnerable(true); } catch (e) { }
        setBossHp(boss, 0.0);
            try { boss.carrier.setHealth(20.0); } catch (e) { }
        boss.spin = 0.0;
        try {
            boss.display.setBlock(COAL_DATA);
            boss.display.setGlowing(true);
            setDisplayTransform(boss.display, DISPLAY_SCALE, 0);
        } catch (e) { }

        try {
            boss.bar.setColor(BarColor.YELLOW);
            boss.bar.setProgress(0.0);
            boss.bar.setTitle(ChatColor.DARK_RED + BOSS_NAME + ChatColor.GRAY + " | "
                    + ChatColor.YELLOW + "火种阶段 · 剩余 " + boss.fireSeedCount + " 个火种");
        } catch (e) { }

        spawnFireSeedPositions(boss);

        try {
            var location = boss.carrier.getLocation();
            boss.world.playSound(location, Sound.ENTITY_WITHER_SPAWN, 2.0, 1.2);
            boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 80, 1.5, 1.2, 1.5, 0.05);
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (!isHard(boss)
                        && player.getLocation().distanceSquared(location) <= 80.0 * 80.0) {
                    player.sendTitle(ChatColor.DARK_RED + "火种阶段",
                            ChatColor.YELLOW + "清除 30 格外的火种！", 5, 45, 10);
                    player.sendMessage(ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.YELLOW
                            + "HP 归零，进入无敌状态并召唤 " + boss.fireSeedCount + " 个火种！");
                }
            }
        } catch (e) { }

        log.info("InfernoFoehn HP 归零，进入火种阶段，火种数量=" + boss.fireSeedCount);
    }

    function finishFireSeedPhase(boss) {
        if (!boss || boss.dead) return;
        boss.fireSeedPhase = false;
        boss.fireSeedAnimation = false;
        boss.largeFireballWarning = null;
        destroyAllFireSeeds(boss);
        try { boss.carrier.setInvulnerable(false); } catch (e) { }
        try {
            boss.display.setBlock(MAGMA_DATA);
            boss.display.setGlowing(false);
        } catch (e) { }
        startDeathSequence(boss);
    }

    function startFireSeedAnimation(boss) {
        if (!boss || !boss.fireSeedPhase) return;
        boss.fireSeedPhase = false;
        boss.fireSeedAnimation = true;
        boss.fireSeedAnimationStartTick = globalTick;
        boss.fireSeedAnimationEndTick = globalTick + FIRE_SEED_ANIMATION_TICKS;
        boss.largeFireballWarning = null;
        destroyAllFireSeeds(boss);

        try {
            boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_ENDER_DRAGON_GROWL, 2.5, 1.4);
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (!isHard(boss)
                        && player.getLocation().distanceSquared(boss.carrier.getLocation()) <= 80.0 * 80.0) {
                    player.sendMessage(ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.YELLOW
                            + "火种化作火焰漩涡，正在回归 BOSS……");
                }
            }
        } catch (e) { }
        log.info("InfernoFoehn 火种阶段结束，开始 5 秒回归动画。");
    }

    function finishFireSeedAnimation(boss) {
        if (!boss || !boss.fireSeedAnimation) return;
        boss.fireSeedAnimation = false;

        var recovered = boss.fireSeedCount * FIRE_SEED_HEAL_PER_SEED;
        if (recovered <= 0.0) {
            startDeathSequence(boss);
            return;
        }

        try {
            boss.carrier.setInvulnerable(false);
            setBossHp(boss, Math.min(getBossMaxHealth(boss), recovered));
            try { boss.carrier.setHealth(20.0); } catch (e) { }
            setBossArmor(boss, true);
            boss.display.setBlock(MAGMA_DATA);
            boss.display.setGlowing(false);
            boss.spin = 0.0;
            setDisplayTransform(boss.display, DISPLAY_SCALE, boss.spin);
        } catch (e) { }

        try {
            boss.bar.setColor(BarColor.RED);
            boss.bar.setTitle(bossBarTitle(getBossHp(boss), boss));
        } catch (e) { }

        boss.nextLargeFireballTick = globalTick + 80;
        boss.nextVolleyTick = globalTick + 140;
        boss.nextChargeTick = globalTick + 180;
        boss.nextAttractTick = globalTick + ATTRACT_COOLDOWN_TICKS;
        boss.largeFireballWarning = null;

        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (!isHard(boss)
                        && player.getLocation().distanceSquared(boss.carrier.getLocation()) <= 80.0 * 80.0) {
                    player.sendMessage(ChatColor.GOLD + "[炎狱焚风] " + ChatColor.YELLOW
                            + "炎狱焚风恢复了 " + Math.round(recovered) + " 点生命值！"
                            + "（剩余火种 " + boss.fireSeedCount + "）");
                }
            }
        } catch (e) { }

        log.info("InfernoFoehn 火种回归完成，恢复 HP=" + recovered + "，剩余火种=" + boss.fireSeedCount);
    }

    function updateFireSeedPhase(boss) {
        // 火种周围的火焰特效
        if (globalTick % 2 === 0) {
            for (var uuid in activeFireSeeds) {
                if (!activeFireSeeds.hasOwnProperty(uuid)) continue;
                var seed = activeFireSeeds[uuid];
                if (!seed || seed.bossUuid !== boss.uuid) continue;
                try {
                    var center = seed.display && seed.display.isValid()
                            ? seed.display.getLocation()
                            : seed.carrier.getLocation();
                    boss.world.spawnParticle(Particle.FLAME, center, 6, 0.35, 0.35, 0.35, 0.02);
                    boss.world.spawnParticle(Particle.LAVA, center, 2, 0.2, 0.2, 0.2, 0.0);
                    boss.world.spawnParticle(Particle.SMOKE, center, 3, 0.3, 0.3, 0.3, 0.01);
                } catch (e) { }
            }
        }

        // 清理已失效的火种（掉出世界 / 被其他插件移除）
        for (var uuid in activeFireSeeds) {
            if (!activeFireSeeds.hasOwnProperty(uuid)) continue;
            var seed = activeFireSeeds[uuid];
            if (!seed || seed.bossUuid !== boss.uuid) continue;
            if (!seed.carrier || !seed.carrier.isValid() || seed.carrier.isDead()) {
                removeFireSeed(uuid, false);
            }
        }

        if (globalTick >= boss.fireSeedPhaseEndTick) {
            startFireSeedAnimation(boss);
        }
    }

    function spawnFireSeedVortexParticles(boss) {
        try {
            var center = boss.display.getLocation();
            var world = center.getWorld();
            var blue = boss.dragonTexture;
            var mainParticle = blue ? Particle.SOUL_FIRE_FLAME : Particle.FLAME;
            var accentParticle = blue ? Particle.SOUL : Particle.LAVA;
            var curves = 7;

            // 用随机二次贝塞尔曲线模拟“无数火焰粒子组成漩涡飞向 BOSS”。
            for (var c = 0; c < curves; c++) {
                var startAngle = Math.random() * Math.PI * 2.0;
                var startRadius = 6.0 + Math.random() * 7.0;
                var p0x = center.getX() + Math.cos(startAngle) * startRadius;
                var p0y = center.getY() + (Math.random() - 0.5) * 6.0;
                var p0z = center.getZ() + Math.sin(startAngle) * startRadius;
                var p2x = center.getX() + (Math.random() - 0.5) * 0.8;
                var p2y = center.getY() + 0.4 + (Math.random() - 0.5) * 0.6;
                var p2z = center.getZ() + (Math.random() - 0.5) * 0.8;
                var p1x = (p0x + p2x) * 0.5 + (Math.random() - 0.5) * 6.0;
                var p1y = (p0y + p2y) * 0.5 + 2.0 + Math.random() * 3.5;
                var p1z = (p0z + p2z) * 0.5 + (Math.random() - 0.5) * 6.0;

                var samples = 8;
                for (var i = 0; i <= samples; i++) {
                    var t = i / samples;
                    var u = 1.0 - t;
                    var x = u * u * p0x + 2.0 * u * t * p1x + t * t * p2x
                            + (Math.random() - 0.5) * 0.14;
                    var y = u * u * p0y + 2.0 * u * t * p1y + t * t * p2y
                            + (Math.random() - 0.5) * 0.14;
                    var z = u * u * p0z + 2.0 * u * t * p1z + t * t * p2z
                            + (Math.random() - 0.5) * 0.14;
                    world.spawnParticle(mainParticle, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
                    if (i % 2 === 0) {
                        world.spawnParticle(accentParticle, x, y, z, 1,
                                0.012, 0.012, 0.012, 0.0);
                    }
                }
            }

            // 中心汇聚点
            world.spawnParticle(mainParticle, center, 10, 0.6, 0.6, 0.6, 0.02);
            world.spawnParticle(Particle.LARGE_SMOKE, center, 4, 0.4, 0.4, 0.4, 0.01);
        } catch (e) { }
    }

    function updateFireSeedAnimation(boss) {
        spawnFireSeedVortexParticles(boss);

        if (globalTick % 10 === 0) {
            try {
                boss.world.playSound(boss.carrier.getLocation(),
                        Sound.ENTITY_BLAZE_BURN, 2.0, 0.7);
            } catch (e) { }
        }

        if (globalTick >= boss.fireSeedAnimationEndTick) {
            finishFireSeedAnimation(boss);
        }
    }



    function syncDisplay(boss) {
        try {
            var base = boss.carrier.getLocation();
            // 原版末影水晶式漂浮：轻微上下浮动。
            var bob = 0.0;
            if (!boss.fireSeedPhase && !boss.fireSeedAnimation) {
                bob = Math.sin(globalTick / 16.0) * 0.12;
            }
            var displayLoc = new Location(boss.world,
                    base.getX(), base.getY() + DISPLAY_CENTER_Y + bob, base.getZ());
            boss.display.teleport(displayLoc);
            boss.display.setRotation(0, 0);

            if (boss.fireSeedPhase || boss.fireSeedAnimation) {
                // 火种阶段：贴图换成煤炭块，停止自转。
                setDisplayTransform(boss.display, DISPLAY_SCALE, 0);
            } else {
                boss.spin = (boss.spin + SPIN_DEGREES_PER_TICK) % 360.0;
                setDisplayTransform(boss.display, DISPLAY_SCALE, boss.spin);
            }
        } catch (e) { }
    }

    function spawnBossParticles(boss) {
        if (globalTick % 2 !== 0) return;
        try {
            var center = boss.display.getLocation();
            var world = center.getWorld();

            // 火种阶段/回归动画：突出煤炭块贴图，只保留少量烟雾，不显示龙卷风。
            if (boss.fireSeedPhase || boss.fireSeedAnimation) {
                if (globalTick % 6 === 0) {
                    world.spawnParticle(Particle.SMOKE, center, 4, 0.6, 0.6, 0.6, 0.01);
                    world.spawnParticle(Particle.SOUL_FIRE_FLAME, center, 2, 0.5, 0.5, 0.5, 0.01);
                }
                return;
            }

            for (var ring = 0; ring < 3; ring++) {
                var radius = 1.55 + ring * 0.60;
                var count = 10 + ring * 2;
                var yOffset = (ring - 1) * 0.55;
                var baseAngle = globalTick * 0.13 + ring * 1.1;
                var particle = (ring === 1) ? Particle.SOUL_FIRE_FLAME : Particle.FLAME;
                for (var i = 0; i < count; i++) {
                    var angle = baseAngle + (Math.PI * 2.0 * i / count);
                    world.spawnParticle(particle,
                            center.getX() + Math.cos(angle) * radius,
                            center.getY() + yOffset,
                            center.getZ() + Math.sin(angle) * radius,
                            1, 0.02, 0.02, 0.02, 0.0);
                }
            }
            if (globalTick % 6 === 0) {
                world.spawnParticle(Particle.LAVA, center, 3, 1.0, 0.8, 1.0, 0.0);
                world.spawnParticle(Particle.SMOKE, center, 4, 1.0, 0.8, 1.0, 0.01);
            }

            // 火焰龙卷风：半血后自动换成蓝色（灵魂火）粒子。
            spawnTornadoEffect(boss, center, world);
        } catch (e) { }
    }

    function spawnTornadoEffect(boss, center, world) {
        try {
            var blue = boss.dragonTexture;
            var mainParticle = blue ? Particle.SOUL_FIRE_FLAME : Particle.FLAME;
            var accentParticle = blue ? Particle.SOUL : Particle.SMALL_FLAME;
            var emberParticle = blue ? Particle.END_ROD : Particle.LAVA;
            var streams = 4;
            var points = 18;
            var height = 5.0;
            var baseAngle = globalTick * 0.30;

            // 每条流都是一条带随机扰动的 3D 螺旋曲线，形成“火龙卷”的层叠结构。
            for (var s = 0; s < streams; s++) {
                var streamPhase = s * (Math.PI * 2.0 / streams);
                var direction = (s % 2 === 0) ? 1.0 : -1.0;
                var twist = 2.8 + (s % 2) * 1.4;
                for (var i = 0; i < points; i++) {
                    var t = i / (points - 1);
                    var wobble = Math.sin(t * Math.PI * 4.0 + globalTick * 0.22 + s) * 0.24;
                    var angle = baseAngle * direction + streamPhase
                            + t * Math.PI * twist + wobble;
                    var radius = 0.25 + t * 2.0
                            + Math.sin(t * Math.PI * 3.0 + s * 1.7) * 0.20;
                    var x = center.getX() + Math.cos(angle) * radius
                            + (Math.random() - 0.5) * 0.22;
                    var y = center.getY() - 0.95 + t * height
                            + (Math.random() - 0.5) * 0.14;
                    var z = center.getZ() + Math.sin(angle) * radius
                            + (Math.random() - 0.5) * 0.22;

                    world.spawnParticle(mainParticle, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
                    if ((i + s) % 2 === 0) {
                        world.spawnParticle(accentParticle, x, y, z, 1,
                                0.012, 0.012, 0.012, 0.0);
                    }
                    if ((i + s) % 5 === 0) {
                        world.spawnParticle(emberParticle, x, y, z, 1,
                                0.0, 0.0, 0.0, 0.0);
                    }
                }
            }

            // 底部火环 + 上升烟雾，让龙卷风更有体积感。
            if (globalTick % 4 === 0) {
                for (var k = 0; k < 14; k++) {
                    var ringAngle = k / 14.0 * Math.PI * 2.0 + globalTick * 0.08;
                    var ringRadius = 1.2 + Math.random() * 0.7;
                    world.spawnParticle(mainParticle,
                            center.getX() + Math.cos(ringAngle) * ringRadius,
                            center.getY() - 1.0 + Math.random() * 0.35,
                            center.getZ() + Math.sin(ringAngle) * ringRadius,
                            1, 0.0, 0.0, 0.0, 0.0);
                    world.spawnParticle(Particle.SMOKE,
                            center.getX() + Math.cos(ringAngle) * ringRadius * 0.55,
                            center.getY() + 0.15 + Math.random() * 0.5,
                            center.getZ() + Math.sin(ringAngle) * ringRadius * 0.55,
                            1, 0.02, 0.02, 0.02, 0.008);
                }
            }
        } catch (e) { }
    }

    function updateVisuals(boss) {
        try {
            // 免疫火焰的同时，避免身上出现燃烧的视觉效果。
            boss.carrier.setFireTicks(0);
            boss.carrier.setVisualFire(false);
        } catch (e) { }
        syncDisplay(boss);
        spawnBossParticles(boss);
    }

    function idleHover(boss) {
        try {
            var location = boss.carrier.getLocation();
            var desiredY = groundSurfaceYNear(boss.world, location.getX(), location.getZ(), location.getY())
                    + HOVER_FEET + Math.sin(globalTick / 25.0) * 0.12;
            var newY = location.getY() + clamp(desiredY - location.getY(), -0.25, 0.25);
            boss.carrier.teleport(new Location(boss.world,
                    location.getX(), newY, location.getZ(), location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    function updateMovement(boss, target) {
        try {
            var location = boss.carrier.getLocation();
            var targetLocation = target.getLocation();
            var moveSpeed = getMoveSpeed(boss);
            var dx = targetLocation.getX() - location.getX();
            var dz = targetLocation.getZ() - location.getZ();
            var horizontalDistance = Math.sqrt(dx * dx + dz * dz);
            if (horizontalDistance < 0.001) return;

            var moveX = 0.0;
            var moveZ = 0.0;
            if (horizontalDistance > 6.0) {
                moveX = dx / horizontalDistance * moveSpeed;
                moveZ = dz / horizontalDistance * moveSpeed;
            } else if (horizontalDistance < 3.0) {
                moveX = -dx / horizontalDistance * moveSpeed * 0.65;
                moveZ = -dz / horizontalDistance * moveSpeed * 0.65;
            } else {
                var direction = (Math.floor(globalTick / 80) % 2 === 0) ? 1.0 : -1.0;
                moveX = -dz / horizontalDistance * moveSpeed * 0.45 * direction;
                moveZ = dx / horizontalDistance * moveSpeed * 0.45 * direction;
            }

            var newX = location.getX() + moveX;
            var newZ = location.getZ() + moveZ;
            var desiredY = groundSurfaceYNear(boss.world, newX, newZ, location.getY())
                    + HOVER_FEET + Math.sin(globalTick / 25.0) * 0.12;
            var newY = location.getY() + clamp(desiredY - location.getY(), -0.25, 0.25);
            boss.carrier.teleport(new Location(boss.world,
                    newX, newY, newZ, location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 杀戮光环
    // ---------------------------------------------------------------------------

function updateAura(boss) {
    if (globalTick % AURA_INTERVAL_TICKS !== 0) return;
    try {
        var bossLocation = boss.carrier.getLocation();
        var world = boss.world;
        var targets = getDamageTargets(boss);
        for (var i = 0; i < targets.length; i++) {
            var auraTarget = targets[i];
            if (!auraTarget || auraTarget.isDead()) continue;
            var distanceSquared = auraTarget.getLocation().distanceSquared(bossLocation);
            if (distanceSquared > AURA_RANGE * AURA_RANGE) continue;

            var damage = AURA_DAMAGE;
            var attracted = isAttractTarget(boss, auraTarget);
            if (attracted) damage *= ATTRACT_AURA_MULTIPLIER;

            auraTarget.setFireTicks(Math.max(auraTarget.getFireTicks(), 80));
            auraTarget.setNoDamageTicks(0);
            auraTarget.damage(damage, boss.carrier);

            world.spawnParticle(attracted ? Particle.SOUL_FIRE_FLAME : Particle.FLAME,
                    auraTarget.getLocation().getX(),
                    auraTarget.getLocation().getY() + 1.0,
                    auraTarget.getLocation().getZ(),
                    4, 0.25, 0.45, 0.25, 0.01);
        }
    } catch (e) { }
}

// ---------------------------------------------------------------------------
// 投射物通用：追踪、尾迹与自定义爆炸
// 爆炸统一调用 Java 的 World.createExplosion(Location, float, ...)，
// 不再依赖原版实体 NBT 的整数爆炸威力。
// ---------------------------------------------------------------------------

function fireballYield(baseYield, boss) {
    return baseYield + (boss && boss.dragonTexture ? PHASE2_FIREBALL_BONUS : 0.0);
}

function spawnTrackedFireball(boss, entityClass, spawnLocation, direction, speed,
        power, trail, life, breakBlocks) {
    var fireball = boss.world.spawn(spawnLocation, entityClass);
    if (!fireball) return null;

    fireball.setShooter(boss.carrier);
    fireball.setDirection(direction);
    try { fireball.setIsIncendiary(false); } catch (e) { }
    // 新生成的火焰弹初始速度为 0，setDirection 会保留当前速度，必须显式赋初速度。
    fireball.setVelocity(direction.clone().multiply(speed));
    fireball.addScoreboardTag(PROJECTILE_TAG);

    trackedProjectiles[String(fireball.getUniqueId().toString())] = {
        proj: fireball,
        kind: "fireball",
        power: power,
        trail: trail,
        life: life,
        breakBlocks: breakBlocks === true
    };
    return fireball;
}

function getProjectileHitLocation(event, projectile) {
    try {
        var hitBlock = event.getHitBlock();
        if (hitBlock != null) {
            var location = hitBlock.getLocation().add(0.5, 0.5, 0.5);
            var face = null;
            try { face = event.getHitBlockFace(); } catch (e) { }
            if (face != null) {
                location.add(face.getModX() * 0.5, face.getModY() * 0.5, face.getModZ() * 0.5);
            }
            return location;
        }
    } catch (e) { }
    return projectile.getLocation();
}

function detonateTrackedFireball(tracked, location) {
    if (!tracked || !location) return;
    try {
        var world = location.getWorld();
        if (!world) return;
        var power = (tracked.power != null) ? tracked.power : 1.0;

        if (tracked.trail === "dragon") {
            world.spawnParticle(Particle.DRAGON_BREATH, location, 60, 1.6, 1.2, 1.6, 0.10);
            world.spawnParticle(Particle.END_ROD, location, 25, 1.2, 1.0, 1.2, 0.04);
        } else if (tracked.trail === "flame") {
            world.spawnParticle(Particle.FLAME, location, 35, 1.1, 0.9, 1.1, 0.06);
        } else {
            world.spawnParticle(Particle.SMALL_FLAME, location, 15, 0.7, 0.6, 0.7, 0.03);
        }
        world.spawnParticle(Particle.EXPLOSION, location, 6, 0.35, 0.35, 0.35, 0.02);

        // 直接调用 Java 爆炸 API（float 参数），支持 1.5 / 2.4 / 4.5 / 6.5 等小数威力。
        // 注意：这里使用 5 参数重载并在 Entity 处传 null，避免 Nashorn 在
        // createExplosion(Location, float, boolean, boolean) 与坐标重载之间产生歧义。
        world.createExplosion(location, power, false, tracked.breakBlocks === true, null);
    } catch (e) {
        log.error("InfernoFoehn 投射物爆炸异常：" + e);
    }
}

function spawnProjectileTrail(tracked) {
    try {
        var location = tracked.proj.getLocation();
        var world = location.getWorld();
        if (!world) return;
        if (tracked.trail === "flame") {
            world.spawnParticle(Particle.FLAME, location, 6, 0.14, 0.14, 0.14, 0.015);
            world.spawnParticle(Particle.LAVA, location, 1, 0.05, 0.05, 0.05, 0.0);
            world.spawnParticle(Particle.SMOKE, location, 2, 0.10, 0.10, 0.10, 0.005);
        } else if (tracked.trail === "dragon") {
            world.spawnParticle(Particle.DRAGON_BREATH, location, 6, 0.12, 0.12, 0.12, 0.01);
            world.spawnParticle(Particle.END_ROD, location, 2, 0.06, 0.06, 0.06, 0.0);
        }
    } catch (e) { }
}

// ---------------------------------------------------------------------------
// 末影水晶火球（超级强化冲撞附带）
// ---------------------------------------------------------------------------

function fireSpecialFireball(boss, target, fallbackDirection) {
    try {
        var base = boss.carrier.getLocation().clone().add(0, 1.6, 0);
        var direction = null;
        if (target && isTargetOnline(target) && !target.isDead()) {
            var aim = target.getEyeLocation().toVector().subtract(base.toVector());
            if (aim.lengthSquared() > 0.001) direction = aim.normalize();
        }
        if (!direction) {
            if (fallbackDirection && fallbackDirection.lengthSquared() > 0.001) {
                direction = fallbackDirection.clone().normalize();
            } else if (boss.charge && boss.charge.dir) {
                direction = boss.charge.dir.clone();
            } else {
                direction = new Vector(1, 0, 0);
            }
        }

        var spawn = base.clone().add(direction.clone().multiply(1.8));
        var crystal = boss.world.spawn(spawn, EnderCrystalClass);
        if (!crystal) return;
        try { crystal.setShowingBottom(false); } catch (e) { }
        try { crystal.setInvulnerable(true); } catch (e) { }
        try { crystal.setGravity(false); } catch (e) { }
        try { crystal.setSilent(true); } catch (e) { }
        try { crystal.setPersistent(true); } catch (e) { }
        crystal.addScoreboardTag(PROJECTILE_TAG);

        trackedProjectiles[String(crystal.getUniqueId().toString())] = {
            proj: crystal,
            kind: "crystal",
            power: SPECIAL_FIREBALL_YIELD,
            dir: direction,
            speed: SPECIAL_FIREBALL_SPEED * (isHard(boss) ? HARD_SPECIAL_FIREBALL_SPEED_MULT : 1.0),
            life: SPECIAL_FIREBALL_LIFE,
            breakBlocks: SPECIAL_FIREBALL_BREAK_BLOCKS,
            hardMode: isHard(boss)
        };

        boss.world.playSound(spawn, Sound.ENTITY_ENDER_DRAGON_SHOOT, 2.5, 1.2);
        boss.world.spawnParticle(Particle.END_ROD, spawn, 25, 0.3, 0.3, 0.3, 0.03);
        boss.world.spawnParticle(Particle.DRAGON_BREATH, spawn, 20, 0.3, 0.3, 0.3, 0.02);
    } catch (e) {
        log.error("InfernoFoehn 末影水晶火球异常：" + e);
    }
}

function updateSpecialFireball(tracked) {
    try {
        var proj = tracked.proj;
        var location = proj.getLocation();
        var direction = tracked.dir;
        var next = location.clone().add(
            direction.getX() * tracked.speed,
            direction.getY() * tracked.speed,
            direction.getZ() * tracked.speed);

        var world = next.getWorld();
        if (!world) return false;

        var feetBlock = next.getBlock();
        var headBlock = feetBlock.getRelative(0, 1, 0);
        if (feetBlock.getType().isSolid() || headBlock.getType().isSolid()) {
            detonateSpecialFireball(next, tracked);
            return true;
        }

        var players = world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead() || !player.isOnline()) continue;
            if (player.getGameMode() == GameMode.SPECTATOR) continue;
            if (String(player.getWorld().getName()) !== String(world.getName())) continue;
            if (player.getLocation().distanceSquared(next) <= 1.8 * 1.8) {
                detonateSpecialFireball(next, tracked);
                return true;
            }
        }

        proj.teleport(next);
        world.spawnParticle(Particle.END_ROD, next, 5, 0.08, 0.08, 0.08, 0.0);
        world.spawnParticle(Particle.DRAGON_BREATH, next, 8, 0.14, 0.14, 0.14, 0.01);
        return false;
    } catch (e) {
        return false;
    }
}

function detonateSpecialFireball(location, tracked) {
    try {
        var world = location.getWorld();
        if (!world) return;

        world.playSound(location, Sound.ENTITY_GENERIC_EXPLODE, 6.0, 0.55);
        world.playSound(location, Sound.ENTITY_ENDER_DRAGON_GROWL, 3.0, 0.7);
        world.spawnParticle(Particle.DRAGON_BREATH, location, 140, 2.4, 1.9, 2.4, 0.12);
        world.spawnParticle(Particle.END_ROD, location, 70, 2.0, 1.6, 2.0, 0.05);
        world.spawnParticle(Particle.EXPLOSION_EMITTER, location, 3, 0.8, 0.8, 0.8, 0);

        // 直接调用 Java 爆炸 API（float），威力 6.5；第 5 个参数传 null 以固定重载。
        world.createExplosion(location, SPECIAL_FIREBALL_YIELD, false, SPECIAL_FIREBALL_BREAK_BLOCKS, null);

        // 爆炸范围内的玩家：失明 / 缓慢 / 中毒 5 秒，恶心 30 秒。
        var players = world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead() || !player.isOnline()) continue;
            if (player.getGameMode() == GameMode.SPECTATOR) continue;
            if (String(player.getWorld().getName()) !== String(world.getName())) continue;
            if (player.getLocation().distanceSquared(location)
                    > SPECIAL_FIREBALL_EFFECT_RADIUS * SPECIAL_FIREBALL_EFFECT_RADIUS) {
                continue;
            }
            player.addPotionEffect(new PotionEffect(PotionEffectType.BLINDNESS,
                    SPECIAL_FIREBALL_EFFECT_TICKS, 0, false, true, true));
            player.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,
                    SPECIAL_FIREBALL_EFFECT_TICKS, 1, false, true, true));
            if (tracked && tracked.hardMode) {
                player.addPotionEffect(new PotionEffect(PotionEffectType.WITHER,
                        HARD_WITHER_TICKS, 0, false, true, true));
            } else {
                player.addPotionEffect(new PotionEffect(PotionEffectType.POISON,
                        SPECIAL_FIREBALL_EFFECT_TICKS, 0, false, true, true));
            }
            player.addPotionEffect(new PotionEffect(PotionEffectType.NAUSEA,
                    SPECIAL_FIREBALL_NAUSEA_TICKS, 0, false, true, true));
            if (!tracked || !tracked.hardMode) {
                player.sendMessage(ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.LIGHT_PURPLE
                        + "末影水晶火球命中了爆炸范围！");
            }
        }
    } catch (e) {
        log.error("InfernoFoehn 末影水晶火球爆炸异常：" + e);
    }
}

// ---------------------------------------------------------------------------
// 大型火焰弹
// ---------------------------------------------------------------------------

function fireLargeFireball(boss, target) {
    try {
        var base = boss.carrier.getLocation().clone().add(0, 1.6, 0);
        var aim = target.getEyeLocation().toVector().subtract(base.toVector());
        if (aim.lengthSquared() < 0.001) return;
        fireLargeFireballDirection(boss, aim.normalize());
    } catch (e) {
        log.error("InfernoFoehn 大型火焰弹异常：" + e);
    }
}

function fireLargeFireballDirection(boss, direction) {
    try {
        if (!direction || direction.lengthSquared() < 0.001) return;
        direction = direction.clone().normalize();
        var base = boss.carrier.getLocation().clone().add(0, 1.6, 0);

        var dragonTexture = boss.dragonTexture;
        var entityClass = dragonTexture ? DragonFireballClass : FireballClass;
        var spawn = base.clone().add(direction.clone().multiply(2.2));
        var power = fireballYield(LARGE_FIREBALL_YIELD, boss);

        spawnTrackedFireball(boss, entityClass, spawn, direction, 1.2, power,
                dragonTexture ? "dragon" : "flame", 240, LARGE_FIREBALL_BREAK_BLOCKS);

        if (dragonTexture) {
            boss.world.playSound(spawn, Sound.ENTITY_ENDER_DRAGON_SHOOT, 3.0, 1.0);
            boss.world.spawnParticle(Particle.DRAGON_BREATH, spawn, 40, 0.35, 0.35, 0.35, 0.06);
        } else {
            boss.world.playSound(spawn, Sound.ENTITY_GHAST_SHOOT, 3.0, 1.0);
            boss.world.spawnParticle(Particle.FLAME, spawn, 30, 0.35, 0.35, 0.35, 0.06);
        }
    } catch (e) {
        log.error("InfernoFoehn 大型火焰弹异常：" + e);
    }
}

function updateTrackedProjectiles() {
    for (var key in trackedProjectiles) {
        if (!trackedProjectiles.hasOwnProperty(key)) continue;
        var tracked = trackedProjectiles[key];
        try {
            if (!tracked || !tracked.proj) {
                delete trackedProjectiles[key];
                continue;
            }

            // 寿命耗尽：水晶火球就地引爆，普通火球直接清理。
            if (tracked.life <= 0) {
                if (tracked.kind === "crystal" && tracked.proj.isValid()) {
                    detonateSpecialFireball(tracked.proj.getLocation().clone());
                }
                try { if (tracked.proj.isValid()) tracked.proj.remove(); } catch (ignored) { }
                delete trackedProjectiles[key];
                continue;
            }

            if (!tracked.proj.isValid()) {
                delete trackedProjectiles[key];
                continue;
            }

            if (tracked.kind === "crystal") {
                if (updateSpecialFireball(tracked)) {
                    try { tracked.proj.remove(); } catch (ignored) { }
                    delete trackedProjectiles[key];
                    continue;
                }
            } else {
                spawnProjectileTrail(tracked);
            }
            tracked.life--;
        } catch (e) {
            delete trackedProjectiles[key];
        }
    }
}

// ---------------------------------------------------------------------------
// 小型火焰弹幕
// ---------------------------------------------------------------------------

function startVolley(boss, target) {
    boss.volleyLeft = SMALL_FIREBALL_COUNT;
    boss.volleyNextTick = globalTick;
    boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_BLAZE_SHOOT, 2.5, 1.4);
    boss.world.spawnParticle(Particle.FLAME, boss.carrier.getLocation(), 40, 1.2, 1.0, 1.2, 0.05);
}

function fireSmallFireball(boss, target, powerOverride, originOverride) {
    try {
        var base = originOverride
                ? originOverride.clone()
                : boss.carrier.getLocation().clone().add(0, 1.35, 0);
        var direction = null;

        if (target && isTargetOnline(target) && !target.isDead() && Math.random() < 0.35) {
            // 约 1/3 瞄准玩家，但带随机散布，避免全部命中。
            var aim = target.getEyeLocation().toVector().subtract(base.toVector());
            if (aim.lengthSquared() > 0.001) {
                direction = aim.normalize()
                    .add(new Vector(
                        (Math.random() - 0.5) * 0.55,
                        (Math.random() - 0.5) * 0.35,
                        (Math.random() - 0.5) * 0.55))
                    .normalize();
            }
        }

        if (!direction) {
            // 其余大部分随机散布向四周，形成接近全覆盖的弹幕。
            var yaw = Math.random() * Math.PI * 2.0;
            var pitch = (Math.random() * 0.75) - 0.25;
            direction = new Vector(
                Math.cos(yaw) * Math.cos(pitch),
                Math.sin(pitch),
                Math.sin(yaw) * Math.cos(pitch)
            ).normalize();
        }

        if (!isFinite(direction.getX()) || direction.lengthSquared() < 0.001) {
            direction = new Vector(1, 0, 0);
        }

        var dragonTexture = boss.dragonTexture;
        var entityClass = dragonTexture ? DragonFireballClass : SmallFireballClass;
        var power = (powerOverride != null)
                ? powerOverride
                : fireballYield(SMALL_FIREBALL_YIELD, boss);
        var spawn = base.clone().add(direction.clone().multiply(1.8));

        spawnTrackedFireball(boss, entityClass, spawn, direction, 1.0, power,
                dragonTexture ? "dragon" : "none", 200, SMALL_FIREBALL_BREAK_BLOCKS);
    } catch (e) {
        log.error("InfernoFoehn 小型火焰弹异常：" + e);
    }
}

function updateVolley(boss, target) {
    if (boss.volleyLeft <= 0) return;
    if (globalTick < boss.volleyNextTick) return;

    // 每次 tick 连续发射多枚，提高弹幕密度。
    var shots = Math.min(SMALL_FIREBALL_PER_TICK, boss.volleyLeft);
    for (var i = 0; i < shots; i++) {
        fireSmallFireball(boss, target);
    }
    boss.volleyLeft -= shots;
    boss.volleyNextTick = globalTick + 1;
}

// ---------------------------------------------------------------------------
// 冲撞
// ---------------------------------------------------------------------------

function startCharge(boss, target, superCharge) {
    var location = boss.carrier.getLocation();
    var direction = target.getLocation().toVector().subtract(location.toVector());
    direction.setY(0);
    var isSuper = superCharge === true;
    var targetUuid = target ? String(target.getUniqueId().toString()) : null;

    if (direction.lengthSquared() < 0.04) {
        // 已经和目标贴脸：直接判定为撞到，避免连续冲撞卡在重叠目标上。
        if (isHard(boss) && target && targetUuid) {
            try { target.setNoDamageTicks(0); } catch (e) { }
            try {
                target.damage(isSuper ? SUPER_CHARGE_DAMAGE : CHARGE_DAMAGE, boss.carrier);
            } catch (e) { }
            refreshHardChargeTargets(boss);
            if (!boss.hardChargeTargets) boss.hardChargeTargets = {};
            boss.hardChargeTargets[targetUuid] = true;
            boss.hardChargeSequence = true;
            boss.nextChargeTick = globalTick + HARD_CHARGE_CHAIN_DELAY_TICKS;
        }
        return false;
    }
    direction.normalize();

    cancelLargeFireballWarning(boss);

    if (isHard(boss)) {
        refreshHardChargeTargets(boss);
        // 困难模式连续冲撞：选中的目标计为一次冲撞并标记完成，保证队列一定推进；
        // 冲锋结束还会对身边目标补一次接触结算。
        if (targetUuid) boss.hardChargeTargets[targetUuid] = true;
        boss.hardChargeSequence = true;
    }

    boss.charge = {
        phase: "telegraph",
        ticksLeft: isSuper ? SUPER_CHARGE_TELEGRAPH_TICKS : CHARGE_TELEGRAPH_TICKS,
        dir: direction,
        travelled: 0.0,
        damageEnabled: true,
        damage: isSuper ? SUPER_CHARGE_DAMAGE : CHARGE_DAMAGE,
        step: isSuper ? SUPER_CHARGE_STEP : CHARGE_STEP,
        maxDistance: isSuper ? SUPER_CHARGE_DISTANCE : CHARGE_DISTANCE,
        hitRadius: isSuper ? SUPER_CHARGE_HIT_RADIUS : CHARGE_HIT_RADIUS,
        superCharge: isSuper,
        specialFireballFired: false,
        fireCount: 0,
        hitPlayers: {},
        targetUuid: targetUuid
    };
    boss.volleyLeft = 0;
    boss.nextChargeTick = globalTick + (isSuper ? SUPER_CHARGE_COOLDOWN : CHARGE_COOLDOWN);

    boss.world.playSound(location, Sound.ENTITY_RAVAGER_ROAR, isSuper ? 3.0 : 2.0, isSuper ? 0.5 : 0.7);
    boss.world.spawnParticle(Particle.SMOKE, location, isSuper ? 120 : 60, 1.5, 1.0, 1.5, 0.05);
    boss.world.spawnParticle(Particle.FLAME, location, isSuper ? 90 : 40, 1.5, 1.0, 1.5, 0.05);
    if (isSuper) {
        boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 50, 1.5, 1.2, 1.5, 0.05);
    }

    if (target && !isHard(boss)) {
        if (isSuper) {
            sendTargetMessage(target, ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.RED + "超级强化冲撞！");
            sendTargetTitle(target, ChatColor.DARK_RED + "超级强化冲撞",
                    ChatColor.RED + "快躲开！", 0, 25, 10);
        } else {
            sendTargetMessage(target, ChatColor.RED + "[炎狱焚风] " + ChatColor.YELLOW + "强化冲撞，快躲开！");
        }
    }
    return true;
}

function endCharge(boss, blocked) {
    var charge = boss.charge;
    boss.charge = null;
    if (!charge) return;

    try {
        var location = boss.carrier.getLocation();
        boss.world.spawnParticle(Particle.SMOKE, location, charge.superCharge ? 70 : 40, 1.5, 1.0, 1.5, 0.05);
        if (blocked) {
            boss.world.playSound(location, Sound.ENTITY_RAVAGER_STUNNED, 2.0, 0.8);
        }
    } catch (e) { }

    // 超级冲撞结束的瞬间发射末影水晶火球（不再在冲锋开始时发射）。
    if (charge.superCharge && !charge.specialFireballFired) {
        charge.specialFireballFired = true;
        try {
            if (isHard(boss)) {
                var players = listHardPlayers(boss, HARD_PLAYER_RADIUS);
                var crystalCount = players.length > 0
                        ? Math.max(1, players.length - 1) : 1;
                for (var i = 0; i < crystalCount; i++) {
                    var target = players.length > 0 ? players[i % players.length] : null;
                    fireSpecialFireball(boss, target, charge.dir);
                }
            } else {
                var singleTarget = findEntityByUuid(boss.world, charge.targetUuid);
                fireSpecialFireball(boss, singleTarget, charge.dir);
            }
        } catch (e) {
            log.error("InfernoFoehn 超级冲撞结束发射水晶火球异常：" + e);
        }
    }

    // 困难模式：只有真正撞到目标才标记完成；否则 5 tick 后继续追撞，直到所有目标都被撞过。
    if (isHard(boss) && boss.hardChargeSequence) {
        // 如果所选目标就在身边但没被打到（贴脸/被阻挡），强制补一次接触伤害，保证队列推进。
        try {
            var selected = findEntityByUuid(boss.world, charge.targetUuid);
            if (selected && !selected.isDead()) {
                var selectedLoc = selected.getLocation();
                var dx = selectedLoc.getX() - boss.carrier.getLocation().getX();
                var dz = selectedLoc.getZ() - boss.carrier.getLocation().getZ();
                var horizontal = Math.sqrt(dx * dx + dz * dz);
                var vertical = Math.abs(selectedLoc.getY() - boss.carrier.getLocation().getY());
                if (horizontal <= (charge.hitRadius || CHARGE_HIT_RADIUS) + 2.0
                        && vertical <= CHARGE_VERTICAL_RADIUS + 1.5) {
                    applyChargeHitDamage(boss, charge, selected,
                            charge.damage != null ? charge.damage : CHARGE_DAMAGE);
                    if (!charge.hitPlayers[charge.targetUuid]) {
                        var healthBefore = selected.getHealth();
                        try {
                            selected.setHealth(Math.max(0.5, healthBefore
                                    - (charge.damage != null ? charge.damage : CHARGE_DAMAGE)));
                        } catch (e) { }
                        charge.hitPlayers[charge.targetUuid] = true;
                    }
                }
            }
        } catch (e) { }

        // 一次冲锋可能沿途撞到多个目标，全部标记完成。
        if (charge.hitPlayers) {
            for (var hitUuid in charge.hitPlayers) {
                if (charge.hitPlayers.hasOwnProperty(hitUuid) && charge.hitPlayers[hitUuid]) {
                    boss.hardChargeTargets[hitUuid] = true;
                }
            }
        }
        var nextTarget = getNextHardChargeTarget(boss);
        if (nextTarget) {
            boss.nextChargeTick = globalTick + HARD_CHARGE_CHAIN_DELAY_TICKS;
            return;
        }
        boss.hardChargeSequence = false;
    }

    boss.nextChargeTick = globalTick + (charge.superCharge ? SUPER_CHARGE_COOLDOWN : CHARGE_COOLDOWN);
}

function igniteGround(world, x, z, charge) {
    if (charge.fireCount >= CHARGE_MAX_FIRE_BLOCKS) return;
    var blockX = Math.floor(x);
    var blockZ = Math.floor(z);
    var surfaceY = groundSurfaceY(world, x, z);
    var above = world.getBlockAt(blockX, Math.floor(surfaceY), blockZ);
    var ground = world.getBlockAt(blockX, Math.floor(surfaceY) - 1, blockZ);
    try {
        if (above.isEmpty() && ground.getType().isSolid() && !ground.isLiquid()) {
            above.setType(Material.FIRE, false);
            charge.fireCount++;
        }
    } catch (e) { }
}

function igniteChargePath(boss, charge, from, to) {
    var distance = from.distance(to);
    var samples = Math.max(1, Math.ceil(distance / 0.5));
    for (var i = 0; i <= samples; i++) {
        var t = i / samples;
        var x = from.getX() + (to.getX() - from.getX()) * t;
        var z = from.getZ() + (to.getZ() - from.getZ()) * t;
        igniteGround(boss.world, x, z, charge);
    }
}

function distanceSquaredToSegmentXZ(px, pz, ax, az, bx, bz) {
    var dx = bx - ax;
    var dz = bz - az;
    var lengthSquared = dx * dx + dz * dz;
    var t = 0.0;
    if (lengthSquared > 0.0001) {
        t = clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0.0, 1.0);
    }
    var closestX = ax + dx * t;
    var closestZ = az + dz * t;
    var offsetX = px - closestX;
    var offsetZ = pz - closestZ;
    return offsetX * offsetX + offsetZ * offsetZ;
}

function applyChargeHitDamage(boss, charge, chargeTarget, chargeDamage) {
    try {
        if (!chargeTarget || chargeTarget.isDead()) return;
        var targetUuid = String(chargeTarget.getUniqueId().toString());
        if (!charge.damageEnabled || charge.hitPlayers[targetUuid]) return;

        chargeTarget.setNoDamageTicks(0);
        var healthBefore = chargeTarget.getHealth();
        chargeTarget.damage(chargeDamage, boss.carrier);

        if (!chargeTarget.isDead() && chargeTarget.getHealth() >= healthBefore
                && !(chargeTarget instanceof PlayerClass
                        && chargeTarget.getGameMode() === GameMode.CREATIVE)) {
            try { chargeTarget.setHealth(Math.max(0.5, healthBefore - chargeDamage)); } catch (e) { }
        }

        if (chargeTarget.isDead() || chargeTarget.getHealth() < healthBefore) {
            charge.hitPlayers[targetUuid] = true;
            chargeTarget.setFireTicks(Math.max(chargeTarget.getFireTicks(), 100));
            var push = charge.dir.clone().multiply(charge.superCharge ? 1.8 : 1.2);
            push.setY(charge.superCharge ? 0.65 : 0.45);
            chargeTarget.setVelocity(push);
            if (!isHard(boss)) {
                if (charge.superCharge) {
                    sendTargetMessage(chargeTarget, ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.RED
                            + "超级强化冲撞命中！");
                } else {
                    sendTargetMessage(chargeTarget, ChatColor.RED + "[炎狱焚风] " + ChatColor.YELLOW
                            + "强化冲撞命中！");
                }
            }
        }
    } catch (e) { }
}

function updateCharge(boss) {
    var charge = boss.charge;
    if (!charge) return;

    var location = boss.carrier.getLocation();

    if (charge.phase === "telegraph") {
        charge.ticksLeft--;
        drawChargeWarning(boss, charge, location);
        if (globalTick % 2 === 0) {
            boss.world.spawnParticle(Particle.FLAME, location, 25, 1.2, 1.2, 1.2, 0.04);
            boss.world.spawnParticle(Particle.SMOKE, location, 15, 1.5, 1.0, 1.5, 0.04);
            if (charge.superCharge) {
                boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 20, 1.2, 1.2, 1.2, 0.04);
            }
        }
        if (charge.ticksLeft <= 0) {
            charge.phase = "dash";
            boss.world.playSound(location, Sound.ENTITY_ENDER_DRAGON_GROWL,
                    charge.superCharge ? 3.0 : 2.0, charge.superCharge ? 0.6 : 0.8);
        }
        syncDisplay(boss);
        return;
    }

    if (charge.phase !== "dash") return;

    var step = charge.step || CHARGE_STEP;
    var maxDistance = charge.maxDistance || CHARGE_DISTANCE;
    var hitRadius = charge.hitRadius || CHARGE_HIT_RADIUS;
    var chargeDamage = (charge.damage != null) ? charge.damage : CHARGE_DAMAGE;

    var newLocation = location.clone().add(
        charge.dir.getX() * step, 0, charge.dir.getZ() * step);

    var surfaceY = groundSurfaceYNear(boss.world, newLocation.getX(), newLocation.getZ(), location.getY()) + HOVER_FEET;
    newLocation.setY(location.getY() + clamp(surfaceY - location.getY(), -1.2, 1.2));

    var feetBlock = newLocation.getBlock();
    var headBlock = feetBlock.getRelative(0, 1, 0);
    if (feetBlock.getType().isSolid() || headBlock.getType().isSolid()) {
        // 撞墙/贴脸时也必须结算接触目标，否则连续冲撞会卡在重叠目标上。
        var contactTargets = getDamageTargets(boss);
        for (var c = 0; c < contactTargets.length; c++) {
            var contact = contactTargets[c];
            if (!contact || contact.isDead()) continue;
            var cLoc = contact.getLocation();
            var cHorizontal = cLoc.toVector().subtract(location.toVector());
            cHorizontal.setY(0);
            if (cHorizontal.lengthSquared() <= (hitRadius + 0.6) * (hitRadius + 0.6)
                    && Math.abs(cLoc.getY() - location.getY()) <= CHARGE_VERTICAL_RADIUS + 1.0) {
                applyChargeHitDamage(boss, charge, contact, chargeDamage);
            }
        }
        endCharge(boss, true);
        return;
    }

    boss.carrier.teleport(newLocation);
    boss.world.spawnParticle(Particle.FLAME, newLocation, 35, 0.6, 0.9, 0.6, 0.06);
    boss.world.spawnParticle(Particle.LAVA, newLocation, 7, 0.5, 0.6, 0.5, 0.02);
    if (charge.superCharge) {
        boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, newLocation, 25, 0.7, 0.9, 0.7, 0.05);
    }

    var targets = getDamageTargets(boss);
    for (var i = 0; i < targets.length; i++) {
        var chargeTarget = targets[i];
        if (!chargeTarget || chargeTarget.isDead()) continue;

        // 使用“线段到实体的距离”而不是只检查终点，避免高速冲撞跳过目标。
        var targetLocation = chargeTarget.getLocation();
        var horizontalDistanceSquared = distanceSquaredToSegmentXZ(
                targetLocation.getX(), targetLocation.getZ(),
                location.getX(), location.getZ(),
                newLocation.getX(), newLocation.getZ());
        var verticalGap = Math.abs(targetLocation.getY() - newLocation.getY());
        if (horizontalDistanceSquared > hitRadius * hitRadius
                || verticalGap > CHARGE_VERTICAL_RADIUS) {
            continue;
        }
        applyChargeHitDamage(boss, charge, chargeTarget, chargeDamage);
    }

    igniteChargePath(boss, charge, location, newLocation);
    charge.travelled += step;
    syncDisplay(boss);

    if (charge.travelled >= maxDistance) {
        endCharge(boss, false);
    }
}

// ---------------------------------------------------------------------------
// 伤害 / 免疫 / 近战连击
// ---------------------------------------------------------------------------

function isFireOrExplosionDamage(cause) {
    if (!cause) return false;
    var name = String(cause.name());
    return name === "FIRE"
        || name === "FIRE_TICK"
        || name === "LAVA"
        || name === "MELTING"
        || name === "HOT_FLOOR"
        || name === "CAMPFIRE"
        || name === "ENTITY_EXPLOSION"
        || name === "BLOCK_EXPLOSION"
        || name === "SUFFOCATION"
        || name === "DROWNING"
        || name === "CRAMMING";
}

function isPlayerDamageSource(entity) {
    if (entity == null) return false;
    try {
        return entity instanceof PlayerClass;
    } catch (e) {
        return false;
    }
}

function startStagger(boss, player) {
    if (!boss || boss.dead || boss.transitioning) return;
    if (boss.staggerTicks > 0) return;

    boss.staggerTicks = STAGGER_DURATION_TICKS;
    boss.rangedHitCount = 0;
    setBossArmor(boss, false);
    if (boss.charge) {
        endCharge(boss, false);
    }
    // 光环必须真正消失：若正在引导吸附激光，硬直会打断它。
    if (boss.attract) {
        endAttract(boss, false);
    }

    try {
        var location = boss.carrier.getLocation();
        boss.world.playSound(location, Sound.ENTITY_RAVAGER_STUNNED, 2.5, 0.55);
        boss.world.spawnParticle(Particle.SMOKE, location, 90, 1.7, 1.3, 1.7, 0.06);
        boss.world.spawnParticle(Particle.CRIT, location, 70, 1.7, 1.3, 1.7, 0.12);
    } catch (e) { }

    if (!isHard(boss)) {
        var message = ChatColor.GOLD + "[炎狱焚风] " + ChatColor.YELLOW
                + "远程攻击累计 " + getRangedThreshold(boss)
                + " 次，陷入 5 秒硬直！杀戮光环消失，受到的近战伤害 ×"
                + STAGGER_MELEE_MULTIPLIER + "！";
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var nearby = players.get(i);
                if (!nearby || nearby.isDead() || !nearby.isOnline()) continue;
                if (nearby.getLocation().distanceSquared(boss.carrier.getLocation()) <= 64.0 * 64.0) {
                    nearby.sendMessage(message);
                }
            }
        } catch (e) { }
    }

    if (player) {
        player.sendActionBar(ChatColor.RED + "硬直触发！杀戮光环消失，BOSS 无法移动！");
        player.sendTitle(ChatColor.GOLD + "远程硬直", ChatColor.YELLOW + "趁机近战输出！",
                0, 25, 10);
    }
}

registerEvent("org.bukkit.event.entity.EntityDamageEvent", function(event) {
    try {
        // 混合碰撞箱：Slime 只做碰撞入口，伤害统一转到计分板。
        var hybridBoss = getHybridBossByEntity(event.getEntity());
        if (hybridBoss) {
            handleHybridCollisionDamage(hybridBoss, event);
            return;
        }

        // 火种：免疫火焰/爆炸，其余按原版结算。
        var seed = getFireSeedByEntity(event.getEntity());
        if (seed) {
            if (isFireOrExplosionDamage(event.getCause())) event.setCancelled(true);
            return;
        }

        var boss = getBossByEntity(event.getEntity());
        if (!boss) return;

        // 本体永远不通过原版生命结算，先取消事件。
        event.setCancelled(true);

        if (boss.dead || boss.transitioning || boss.fireSeedPhase || boss.fireSeedAnimation) return;
        if (isFireOrExplosionDamage(event.getCause())) return;

        var direct = null;
        var causing = null;
        try {
            var source = event.getDamageSource();
            if (source != null) {
                direct = source.getDirectEntity();
                causing = source.getCausingEntity();
            }
        } catch (ignored) { }

        var attacker = causing != null ? causing : direct;
        if (attacker != null) {
            if (!isPlayerDamageSource(attacker) && !isDisorderDamageSource(attacker)
                    && !isDouQuQuActive(boss)) {
                return;
            }
        }

        if (attacker != null && shouldIgnoreDuplicateDamage(boss, attacker)) return;

        var amount = event.getFinalDamage();
        if (!(amount > 0.0)) return;

        // 近战：硬直期间受到玩家近战伤害 ×1.5。
        if (direct instanceof PlayerClass) {
            var causeName = String(event.getCause().name());
            if ((causeName === "ENTITY_ATTACK" || causeName === "ENTITY_SWEEP_ATTACK")
                    && boss.staggerTicks > 0) {
                amount *= STAGGER_MELEE_MULTIPLIER;
            }
            damageBossByScoreboard(boss, amount);
            return;
        }

        // 远程：玩家投射物累计命中，达到阈值触发硬直。
        if (direct instanceof ProjectileClass) {
            var shooter = direct.getShooter();
            if (shooter instanceof PlayerClass) {
                recordRangedHit(boss, shooter);
            }
        }
        damageBossByScoreboard(boss, amount);
    } catch (e) {
        log.error("InfernoFoehn 受伤事件异常：" + e);
    }
});

registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function(event) {
    try {
        // 伤害已在 EntityDamageEvent 中统一转入计分板，这里仅做占用保护，避免重复结算。
        if (getHybridBossByEntity(event.getEntity()) != null) return;
    } catch (e) { }
});

registerEvent("org.bukkit.event.entity.EntityDeathEvent", function(event) {
    try {
        var hybridBoss = getHybridBossByEntity(event.getEntity());
        if (hybridBoss) {
            event.setCancelled(true);
            try {
                event.getEntity().setHealth(20.0);
                syncHybridCollision(hybridBoss);
            } catch (e) { }
            return;
        }

        var seed = getFireSeedByEntity(event.getEntity());
        if (seed) {
            event.getDrops().clear();
            event.setDroppedExp(0);
            removeFireSeed(seed.uuid, true);
            return;
        }

        var boss = getBossByEntity(event.getEntity());
        if (!boss) return;
        event.getDrops().clear();
        event.setDroppedExp(0);

        if (!boss.dead && (boss.fireSeedPhase || boss.fireSeedAnimation)) {
            event.setCancelled(true);
            setBossHp(boss, 0.0);
            try { boss.carrier.setHealth(20.0); } catch (e) { }
            return;
        }

        if (!boss.dead && boss.fireSeedCount > 0
                && !boss.fireSeedPhase && !boss.fireSeedAnimation) {
            event.setCancelled(true);
            setBossHp(boss, 0.0);
            try { boss.carrier.setHealth(20.0); } catch (e) { }
            startFireSeedPhase(boss);
            return;
        }

        startDeathSequence(boss);
    } catch (e) {
        log.error("InfernoFoehn 死亡事件异常：" + e);
    }
});

function handleTrackedProjectileHit(event, projectile) {
    var key = String(projectile.getUniqueId().toString());
    var tracked = trackedProjectiles[key];
    if (!tracked || tracked.kind !== "fireball") return false;
    if (tracked.detonated) return true;

    tracked.detonated = true;
    var location = getProjectileHitLocation(event, projectile);
    try { if (projectile.isValid()) projectile.remove(); } catch (e) { }
    detonateTrackedFireball(tracked, location);
    return true;
}

registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function(event) {
    try {
        var projectile = event.getEntity();
        if (!projectile) return;
        var tracked = trackedProjectiles[String(projectile.getUniqueId().toString())];
        if (!tracked || tracked.kind !== "fireball") return;
        event.setCancelled(true);
        handleTrackedProjectileHit(event, projectile);
    } catch (e) {
        log.error("InfernoFoehn 投射物命中事件异常：" + e);
    }
});

registerEvent("org.bukkit.event.entity.ExplosionPrimeEvent", function(event) {
    try {
        var entity = event.getEntity();
        if (!entity) return;
        var key = String(entity.getUniqueId().toString());
        var tracked = trackedProjectiles[key];
        if (!tracked || tracked.kind !== "fireball") return;
        event.setCancelled(true);
        if (!tracked.detonated) {
            tracked.detonated = true;
            detonateTrackedFireball(tracked, entity.getLocation());
        }
        delete trackedProjectiles[key];
    } catch (e) { }
});

function registerDragonFireballHitEvent() {
    try {
        registerEvent("com.destroystokyo.paper.event.entity.EnderDragonFireballHitEvent", function(event) {
            try {
                var entity = event.getEntity();
                if (!entity) return;
                var key = String(entity.getUniqueId().toString());
                var tracked = trackedProjectiles[key];
                if (!tracked || tracked.kind !== "fireball") return;
                event.setCancelled(true);
                if (!tracked.detonated) {
                    tracked.detonated = true;
                    detonateTrackedFireball(tracked, entity.getLocation());
                }
                delete trackedProjectiles[key];
            } catch (e) { }
        });
    } catch (e) {
        log.warn("InfernoFoehn 无法注册 EnderDragonFireballHitEvent：" + e);
    }
}
registerDragonFireballHitEvent();

registerEvent("org.bukkit.event.player.PlayerTeleportEvent", function(event) {
    try {
        var player = event.getPlayer();
        if (!player) return;
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (!boss || !boss.attract) continue;
            if (!isAttractTarget(boss, player)) continue;
            var pearl = (event.getCause() == TeleportCause.ENDER_PEARL);
            if (boss.attract.targets && boss.attract.targets.length > 1) {
                var playerUuid = String(player.getUniqueId().toString());
                var kept = [];
                for (var t = 0; t < boss.attract.targets.length; t++) {
                    var candidate = boss.attract.targets[t];
                    if (candidate && String(candidate.getUniqueId().toString()) !== playerUuid) {
                        kept.push(candidate);
                    }
                }
                boss.attract.targets = kept;
                boss.attract.targetUuids = {};
                for (var k = 0; k < kept.length; k++) {
                    boss.attract.targetUuids[String(kept[k].getUniqueId().toString())] = true;
                }
                boss.attract.target = kept.length > 0 ? kept[0] : null;
                if (kept.length === 0) endAttract(boss, pearl);
            } else {
                endAttract(boss, pearl);
            }
        }
    } catch (e) { }
});

// ---------------------------------------------------------------------------
// 引燃阶段（HP < 400）
// ---------------------------------------------------------------------------

function startPhaseTransition(boss) {
    if (!boss || boss.dead || boss.phase2Triggered) return;
    if (!boss.carrier || !boss.carrier.isValid()) return;

    boss.pendingPhase = false;
    boss.phase2Triggered = true;
    boss.dragonTexture = true;
    boss.transitioning = true;
    log.info("InfernoFoehn 生命值低于半血，开始引燃倒计时。");
    boss.transitionStartTick = globalTick;
    boss.transitionEndTick = globalTick + getPhaseFlashTicks(boss);
    boss.volleyLeft = 0;
    boss.charge = null;
    boss.staggerTicks = 0;
    boss.rangedHitCount = 0;
    setBossArmor(boss, false);
    if (boss.attract) endAttract(boss, false);

    try { boss.carrier.setInvulnerable(true); } catch (e) { }
    try {
        boss.bar.setTitle(ChatColor.DARK_RED + getBossDisplayName(boss) + ChatColor.GRAY + "  |  "
                + ChatColor.RED + "" + ChatColor.BOLD + "引燃中...");
        boss.bar.setColor(BarColor.YELLOW);
    } catch (e) { }

    try {
        var location = boss.carrier.getLocation();
        boss.world.playSound(location, Sound.ENTITY_WITHER_SPAWN, 2.0, 0.8);
        boss.world.spawnParticle(Particle.EXPLOSION_EMITTER, location, 5, 1.2, 1.2, 1.2, 0);
        if (!isHard(boss)) {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead()) continue;
                if (player.getLocation().distanceSquared(location) <= 60.0 * 60.0) {
                    player.sendTitle(ChatColor.DARK_RED + "警 告",
                            ChatColor.RED + "炎狱焚风即将爆炸！", 5, 45, 10);
                    player.sendMessage(ChatColor.DARK_RED + "[炎狱焚风] " + ChatColor.RED
                            + "生命值低于 400，5 秒后引发毁灭性爆炸！");
                }
            }
        }
    } catch (e) { }
}

function toggleFlashDisplay(boss, on) {
    try {
        boss.display.setBlock(on ? FLASH_DATA : MAGMA_DATA);
        boss.display.setGlowing(on);
        setDisplayTransform(boss.display, on ? DISPLAY_SCALE * 1.30 : DISPLAY_SCALE, boss.spin);
    } catch (e) { }
}

function updatePhaseTransition(boss) {
    var elapsed = globalTick - boss.transitionStartTick;
    var on = (Math.floor(elapsed / 2) % 2 === 0);

    if (boss.carrier && boss.carrier.isValid()) {
        syncDisplay(boss);
        toggleFlashDisplay(boss, on);

        try {
            var location = boss.carrier.getLocation();
            if (elapsed % 2 === 0) {
                boss.world.spawnParticle(Particle.FLAME, location, 90, 1.8, 1.8, 1.8, 0.09);
                boss.world.spawnParticle(Particle.LAVA, location, 22, 1.4, 1.4, 1.4, 0.03);
                boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 35, 1.6, 1.6, 1.6, 0.06);
            }
            if (elapsed % 10 === 0) {
                boss.world.playSound(location, Sound.ENTITY_BLAZE_BURN, 2.0, 0.8);
            }
        } catch (e) { }
    }

    if (globalTick >= boss.transitionEndTick) {
        boss.transitioning = false;
        finishPhaseTransition(boss);
    }
}

function finishPhaseTransition(boss) {
    try {
        var location = boss.carrier && boss.carrier.isValid()
                ? boss.carrier.getLocation().clone()
                : boss.display.getLocation().clone();
        location.add(0, 1.0, 0);
        detonate(location, getPhaseExplosionPower(boss), false);

        try {
            boss.display.setBlock(MAGMA_DATA);
            boss.display.setGlowing(false);
            setDisplayTransform(boss.display, DISPLAY_SCALE, boss.spin);
        } catch (e) { }

        scheduleSync(2, function() {
            try {
                if (boss.carrier && boss.carrier.isValid()) {
                    boss.carrier.setInvulnerable(false);
                    setBossArmor(boss, true);
                }
            } catch (e) { }
        });

        try {
            boss.bar.setTitle(bossBarTitle(getBossHp(boss), boss));
            boss.bar.setColor(BarColor.RED);
        } catch (e) { }

        boss.nextLargeFireballTick = globalTick + 100;
        boss.nextVolleyTick = globalTick + 140;
        boss.nextChargeTick = globalTick + 180;
        // 半血后新增能力：吸附激光在阶段转换结束后进入冷却，给玩家反应时间。
        boss.nextAttractTick = globalTick + ATTRACT_COOLDOWN_TICKS;
        boss.staggerTicks = 0;
        boss.rangedHitCount = 0;
        boss.dragonTexture = true;
        log.info("InfernoFoehn 引燃爆炸完成，BOSS 继续战斗。");
    } catch (e) {
        log.error("InfernoFoehn 引燃爆炸异常：" + e);
    }
}

// ---------------------------------------------------------------------------
// 死亡爆炸
// ---------------------------------------------------------------------------

function startDeathSequence(boss) {
    if (!boss || boss.dead) return;
    boss.dead = true;
    boss.transitioning = false;
    boss.pendingPhase = false;
    boss.phase2Triggered = true;
    boss.volleyLeft = 0;
    boss.charge = null;
    boss.staggerTicks = 0;
    boss.rangedHitCount = 0;
    setBossArmor(boss, false);
    if (boss.attract) endAttract(boss, false);

    boss.deathStartTick = globalTick;
    boss.deathEndTick = globalTick + getDeathFlashTicks(boss);
    boss.deathLocation = boss.carrier && boss.carrier.isValid()
            ? boss.carrier.getLocation().clone()
            : boss.display.getLocation().clone();

    removeBossBar(boss);

    try {
        var location = boss.deathLocation.clone();
        boss.world.playSound(location, Sound.ENTITY_WITHER_DEATH, 3.0, 0.6);
        boss.world.spawnParticle(Particle.EXPLOSION_EMITTER, location, 4, 1.0, 1.0, 1.0, 0);
        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead()) continue;
            if (!isHard(boss)
                    && player.getLocation().distanceSquared(location) <= 60.0 * 60.0) {
                player.sendTitle(ChatColor.DARK_RED + getBossDisplayName(boss) + " 陨落",
                        ChatColor.RED + "它正在积蓄最后的爆炸！", 5, 50, 10);
            }
        }
    } catch (e) { }

    log.info("InfernoFoehn 进入死亡闪烁阶段。");
}

function updateDeathSequence(boss, uuid) {
    var elapsed = globalTick - boss.deathStartTick;
    try {
        boss.deathLocation = boss.deathLocation.clone().add(0, 0.018, 0);
        var on = (Math.floor(elapsed / 2) % 2 === 0);

        if (boss.display && boss.display.isValid()) {
            boss.display.teleport(boss.deathLocation.clone().add(0, DISPLAY_CENTER_Y, 0));
            boss.display.setRotation(0, 0);
            boss.display.setBlock(on ? FLASH_DATA : MAGMA_DATA);
            boss.display.setGlowing(on);
            setDisplayTransform(boss.display, on ? DISPLAY_SCALE * 1.45 : DISPLAY_SCALE * 1.10,
                    (globalTick * 25.0) % 360.0);
        }

        var location = boss.deathLocation;
        if (elapsed % 2 === 0) {
            boss.world.spawnParticle(Particle.FLAME, location, 140, 2.2, 2.0, 2.2, 0.10);
            boss.world.spawnParticle(Particle.LAVA, location, 35, 1.6, 1.6, 1.6, 0.03);
            boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 55, 2.0, 1.8, 2.0, 0.06);
            boss.world.spawnParticle(Particle.LARGE_SMOKE, location, 40, 1.8, 1.8, 1.8, 0.05);
        }
        if (elapsed % 10 === 0) {
            boss.world.playSound(location, Sound.ENTITY_BLAZE_BURN, 2.0, 0.5);
        }

        // 死亡前摇期间不间断发射小火球；困难模式密度更高且绝大多数瞄准玩家。
        var deathShots = getDeathFireballPerTick(boss);
        var deathYield = getDeathSmallFireballYield(boss);
        var hardTargets = isHard(boss)
                ? listHardPlayers(boss, HARD_PLAYER_RADIUS)
                : [];
        if (hardTargets.length > 0) {
            for (var shot = 0; shot < deathShots; shot++) {
                var shotTarget = (Math.random() < 0.85)
                        ? hardTargets[shot % hardTargets.length] : null;
                fireSmallFireball(boss, shotTarget, deathYield, boss.deathLocation, true);
            }
        } else {
            var deathTarget = findNearestPlayer(boss);
            for (var shot2 = 0; shot2 < deathShots; shot2++) {
                fireSmallFireball(boss, deathTarget, deathYield, boss.deathLocation);
            }
        }
    } catch (e) { }

    if (globalTick >= boss.deathEndTick) {
        var finalLocation = boss.deathLocation.clone();
        detonate(finalLocation, getDeathExplosionPower(boss), true);
        cleanupBoss(boss, uuid);
        log.info("InfernoFoehn 死亡爆炸完成。");
    }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

function updateBossBar(boss) {
    if (globalTick % 5 !== 0) return;
    try {
        if (boss.fireSeedPhase) {
            boss.bar.setProgress(0.0);
            boss.bar.setColor(BarColor.YELLOW);
            boss.bar.setTitle(ChatColor.DARK_RED + getBossDisplayName(boss) + ChatColor.GRAY + "  |  "
                    + ChatColor.YELLOW + "火种阶段 · 剩余 " + boss.fireSeedCount + " 个火种");
        } else if (boss.fireSeedAnimation) {
            boss.bar.setProgress(0.0);
            boss.bar.setColor(BarColor.YELLOW);
            boss.bar.setTitle(ChatColor.DARK_RED + getBossDisplayName(boss) + ChatColor.GRAY + "  |  "
                    + ChatColor.GOLD + "火种回归中...");
        } else {
            var health = getBossHp(boss);
            boss.bar.setProgress(clamp(health / getBossMaxHealth(boss), 0.0, 1.0));
            if (!boss.transitioning && !boss.dead) {
                boss.bar.setTitle(bossBarTitle(health, boss));
            }
        }

        var bossLocation = boss.carrier.getLocation();
        var currentPlayers = boss.bar.getPlayers();
        var toRemove = [];
        for (var i = 0; i < currentPlayers.size(); i++) {
            var barPlayer = currentPlayers.get(i);
            var sameWorld = String(barPlayer.getWorld().getName())
                    === String(boss.world.getName());
            if (!sameWorld
                    || barPlayer.getLocation().distanceSquared(bossLocation) > 64.0 * 64.0) {
                toRemove.push(barPlayer);
            }
        }
        for (var j = 0; j < toRemove.length; j++) {
            boss.bar.removePlayer(toRemove[j]);
        }

        var online = Bukkit.getOnlinePlayers();
        var iterator = online.iterator();
        while (iterator.hasNext()) {
            var player = iterator.next();
            if (String(player.getWorld().getName()) === String(boss.world.getName())
                    && player.getLocation().distanceSquared(bossLocation) <= 64.0 * 64.0) {
                if (!boss.bar.getPlayers().contains(player)) {
                    boss.bar.addPlayer(player);
                }
            }
        }
    } catch (e) { }
}

function drawGuardianLaser(world, from, to) {
    try {
        var direction = to.toVector().subtract(from.toVector());
        var distance = direction.length();
        if (distance < 0.01) return;
        direction.normalize();

        var samples = Math.min(90, Math.max(1, Math.ceil(distance / 0.8)));
        for (var i = 0; i <= samples; i++) {
            var t = i / samples;
            var x = from.getX() + direction.getX() * distance * t;
            var y = from.getY() + direction.getY() * distance * t;
            var z = from.getZ() + direction.getZ() * distance * t;
            // 用青色粒子束模拟原版守卫者激光贴图。
            world.spawnParticle(Particle.SOUL_FIRE_FLAME, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
            if (i % 3 === 0) {
                world.spawnParticle(Particle.ELECTRIC_SPARK, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
            }
            if (i % 6 === 0) {
                world.spawnParticle(Particle.END_ROD, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
            }
        }
    } catch (e) { }
}

    function isAttractTarget(boss, player) {
        if (!boss || !boss.attract || !player) return false;
        try {
            var uuid = String(player.getUniqueId().toString());
            if (boss.attract.targetUuids && boss.attract.targetUuids[uuid]) return true;
            return !!boss.attract.target
                    && String(boss.attract.target.getUniqueId().toString()) === uuid;
        } catch (e) {
            return false;
        }
    }

    function startAttract(boss, target) {
        if (!boss || !target || boss.attract) return;
        cancelLargeFireballWarning(boss);

        var targets = [];
        var targetUuids = {};
        if (isHard(boss)) {
            var players = listHardPlayers(boss, HARD_PLAYER_RADIUS);
            for (var i = 0; i < players.length; i++) {
                targets.push(players[i]);
                targetUuids[String(players[i].getUniqueId().toString())] = true;
            }
        }
        if (targets.length === 0) {
            targets.push(target);
            targetUuids[String(target.getUniqueId().toString())] = true;
        }

        boss.attract = {
            target: targets[0],
            targets: targets,
            targetUuids: targetUuids,
            targetName: targets.length === 1 ? targets[0].getName()
                    : (targets.length + " 名玩家"),
            endTick: globalTick + ATTRACT_DURATION_TICKS,
            nextReminderTick: 0
        };
        boss.volleyLeft = 0;
        if (boss.charge) endCharge(boss, false);

        try {
            boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_ELDER_GUARDIAN_CURSE, 3.0, 0.8);
            boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME,
                    boss.carrier.getLocation().clone().add(0, BOSS_CENTER_Y_OFFSET, 0),
                    80, 1.2, 1.2, 1.2, 0.05);
        } catch (e) { }

        if (!isHard(boss)) {
            sendTargetMessage(target, ChatColor.DARK_AQUA + "[炎狱焚风] " + ChatColor.AQUA
                    + "你被吸附激光锁定！使用末影珍珠可以立刻脱离。");
            sendTargetTitle(target, ChatColor.DARK_AQUA + "吸附激光",
                    ChatColor.AQUA + "使用末影珍珠脱离！", 0, 30, 10);
            sendTargetActionBar(target, ChatColor.AQUA + "吸附激光将持续 30 秒，末影珍珠可脱离！");
        }
    }

    function endAttract(boss, escaped) {
        if (!boss || !boss.attract) return;
        var attract = boss.attract;
        boss.attract = null;
        boss.nextAttractTick = globalTick + ATTRACT_COOLDOWN_TICKS;

        try {
            if (!isHard(boss)) {
                var list = attract.targets || (attract.target ? [attract.target] : []);
                for (var i = 0; i < list.length; i++) {
                    var target = list[i];
                    if (target && isTargetOnline(target) && !target.isDead()) {
                        sendTargetMessage(target, ChatColor.DARK_AQUA + "[炎狱焚风] " + ChatColor.GRAY
                                + (escaped ? "你使用末影珍珠脱离了吸附激光。" : "吸附激光结束。"));
                    }
                }
            }
            boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_ELDER_GUARDIAN_HURT, 2.0, 1.1);
        } catch (e) { }
    }

    function updateAttract(boss) {
        var attract = boss.attract;
        if (!attract) return false;

        var targets = attract.targets;
        if (!targets || targets.length === 0) {
            targets = attract.target ? [attract.target] : [];
            attract.targets = targets;
        }

        var bossLocation = boss.carrier.getLocation();
        var center = bossLocation.clone().add(0, BOSS_CENTER_Y_OFFSET, 0);
        var alive = [];

        try {
            if (globalTick >= attract.endTick) {
                endAttract(boss, false);
                return false;
            }

            for (var i = 0; i < targets.length; i++) {
                var target = targets[i];
                if (!target || !isTargetOnline(target) || target.isDead()
                        || isTargetSpectator(target)
                        || String(target.getWorld().getName()) !== String(boss.world.getName())) {
                    continue;
                }
                var playerLocation = target.getLocation();
                if (playerLocation.distance(bossLocation) > ATTRACT_BREAK_DISTANCE) {
                    continue;
                }
                alive.push(target);

                var pull = center.toVector().subtract(playerLocation.toVector());
                var pullDistance = pull.length();
                if (pullDistance > 0.05) {
                    pull.normalize();
                    var strength = Math.min(ATTRACT_PULL_SPEED, Math.max(0.12, pullDistance * 0.10));
                    if (isHard(boss)) strength *= HARD_ATTRACT_PULL_MULTIPLIER;
                    var velocity = pull.multiply(strength);
                    var verticalCorrection = clamp((center.getY() - playerLocation.getY()) * 0.08,
                            -0.22, 0.22);
                    velocity.setY(verticalCorrection + ATTRACT_PULL_LIFT * 0.3);
                    target.setVelocity(velocity);
                    target.setFallDistance(0);
                    if (target instanceof PlayerClass) {
                        try { target.setSprinting(false); } catch (e) { }
                    }
                }

                drawGuardianLaser(boss.world, center, playerLocation.clone().add(0, 1.0, 0));
            }

            attract.targets = alive;
            attract.targetUuids = {};
            for (var k = 0; k < alive.length; k++) {
                attract.targetUuids[String(alive[k].getUniqueId().toString())] = true;
            }
            if (alive.length === 0) {
                endAttract(boss, false);
                return false;
            }
            attract.target = alive[0];

            if (!isHard(boss) && globalTick >= attract.nextReminderTick) {
                attract.nextReminderTick = globalTick + 40;
                sendTargetActionBar(attract.target,
                        ChatColor.AQUA + "吸附激光锁定中……使用末影珍珠可脱离！");
                try {
                    attract.target.getWorld().playSound(attract.target.getLocation(),
                            Sound.ENTITY_GUARDIAN_ATTACK, 1.0, 1.5);
                } catch (e) { }
            }
            return true;
        } catch (e) {
            endAttract(boss, false);
            return false;
        }
    }

    function updateAttackCooldowns(boss, target) {
        var bossLocation = boss.carrier.getLocation();
        var distanceSquared = target.getLocation().distanceSquared(bossLocation);

        // 硬直期间不主动释放任何技能（双保险，调用方通常已提前 return）。
        if (boss.staggerTicks > 0) return;

        // 半血后优先使用吸附激光，锁定距离最远的敌人。
        if (boss.phase2Triggered && !boss.attract && !boss.charge && boss.volleyLeft <= 0
                && globalTick >= boss.nextAttractTick) {
            var farTarget = findFarthestTarget(boss);
            if (farTarget) {
                startAttract(boss, farTarget);
                return;
            }
        }

        // 冲撞优先级最高，但困难模式连续冲撞序列由 updateBoss 专门推进。
        if (!boss.charge && boss.volleyLeft <= 0
                && !(isHard(boss) && boss.hardChargeSequence)
                && globalTick >= boss.nextChargeTick
                && distanceSquared <= CHARGE_RANGE * CHARGE_RANGE) {
            startCharge(boss, target, false);
            return;
        }

        if (boss.volleyLeft > 0) return;

        if (!boss.largeFireballWarning
                && globalTick >= boss.nextLargeFireballTick
                && distanceSquared <= LARGE_FIREBALL_RANGE * LARGE_FIREBALL_RANGE
                && boss.carrier.hasLineOfSight(target)) {
            // 先进行 12 tick 红色粒子激光预警，预警结束后才真正发射。
            startLargeFireballWarning(boss, target);
        }

        if (globalTick >= boss.nextVolleyTick
                && distanceSquared <= SMALL_FIREBALL_RANGE * SMALL_FIREBALL_RANGE) {
            startVolley(boss, target);
            boss.nextVolleyTick = globalTick + SMALL_FIREBALL_COOLDOWN;
        }
    }

    function updateBoss(boss, uuid) {
        if (boss.dead) {
            updateDeathSequence(boss, uuid);
            return;
        }

        if (!boss.carrier || !boss.carrier.isValid() || boss.carrier.isDead()) {
            cleanupBoss(boss, uuid);
            return;
        }
        if (!boss.display || !boss.display.isValid()) {
            cleanupBoss(boss, uuid);
            return;
        }

        // 火种阶段 / 5 秒回归动画：BOSS 无敌、贴图煤炭块、停止旋转，不进行常规 AI。
        if (boss.fireSeedPhase || boss.fireSeedAnimation) {
            updateVisuals(boss);
            updateBossBar(boss);
            if (boss.fireSeedPhase) {
                updateFireSeedPhase(boss);
            } else {
                updateFireSeedAnimation(boss);
            }
            return;
        }

        if (boss.transitioning) {
            updatePhaseTransition(boss);
            return;
        }

        // 以真实血量为准：低于半血时进入引燃阶段（困难模式按动态最大生命的 50%）。
        var phaseThreshold = isHard(boss) ? getBossMaxHealth(boss) / 2.0 : PHASE_THRESHOLD;
        var currentBossHp = getBossHp(boss);
        if (!boss.phase2Triggered && !boss.pendingPhase
                && currentBossHp > 0.0
                && currentBossHp < phaseThreshold) {
            boss.pendingPhase = true;
            scheduleSync(1, function() {
                startPhaseTransition(boss);
            });
        }

        updateVisuals(boss);
        updateBossBar(boss);

        var target = findNearestPlayer(boss);
        boss.target = target;

        // 大型火焰弹红色粒子激光预警（预警结束后自动发射）。
        updateLargeFireballWarning(boss);

        if (isHard(boss)) {
            if (globalTick % 5 === 0) refreshHardChargeTargets(boss);
            if (!boss.charge && globalTick >= boss.nextChargeTick) {
                var nextChargeTarget = getNextHardChargeTarget(boss);
                if (nextChargeTarget) {
                    startCharge(boss, nextChargeTarget, false);
                    return;
                }
                boss.hardChargeSequence = false;
            }
        }

        if (boss.charge) {
            updateCharge(boss);
            return;
        }

        // 吸附激光引导中：BOSS 原地悬浮（无法移动、冲撞、大火球），
        // 杀戮光环仍然生效；被吸附的目标受到双倍光环伤害。
        if (boss.attract) {
            var attracting = updateAttract(boss);
            if (target) {
                updateAura(boss);
                updateVolley(boss, target);
            }
            if (attracting) return;
        }

        // 远程硬直：杀戮光环消失，BOSS 无法移动/冲撞/大火球；
        // 硬直结束的瞬间，半血 BOSS 立即发动一次超级强化冲撞。
        if (boss.staggerTicks > 0) {
            boss.staggerTicks--;
            if (boss.staggerTicks <= 0) setBossArmor(boss, true);
            if (boss.staggerTicks <= 0 && boss.phase2Triggered && target) {
                startCharge(boss, target, true);
                return;
            }
            if (target) updateVolley(boss, target);
            return;
        }

        if (!target) {
            idleHover(boss);
            return;
        }

        updateMovement(boss, target);
        updateAura(boss);
        updateVolley(boss, target);
        updateAttackCooldowns(boss, target);
    }

    function updateAllBosses() {
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (!boss) continue;
            try {
                registerDouQuQuEntities(boss);
                updateBoss(boss, uuid);
                if (activeBosses.hasOwnProperty(uuid) && activeBosses[uuid] === boss) {
                    syncHybridCollision(boss);
                    syncBossScoreboard(boss);
                }
            } catch (e) {
                log.error("InfernoFoehn BOSS[" + uuid + "] tick 异常：" + e
                        + (e && e.stack ? "\n" + e.stack : ""));
            }
        }
    }

    task.repeat(ticks(1), ticks(1), function() {
        globalTick++;
        try {
            processSyncDelayedTasks();
        } catch (e) {
            log.error("InfernoFoehn 延迟任务队列异常：" + e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            log.error("InfernoFoehn 主循环异常：" + e);
        }
        try {
            updateBgm();
        } catch (e) {
            log.error("InfernoFoehn BGM 主循环异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
        try {
            updateTrackedProjectiles();
        } catch (e) { }
    });

    // 延迟 1 tick 清理上一次脚本实例遗留的实体和血条，避免修改世界的调用发生在异步加载线程。
    scheduleSync(1, function() {
        cleanupOrphans();
    });

    // ---------------------------------------------------------------------------
    // 注册到 /call 框架
    // ---------------------------------------------------------------------------

    var bossDefinition = {
        id: BOSS_ID,
        name: BOSS_NAME,
        aliases: ["炎狱焚风", "inferno_foehn", "infernofoehn", "foehn"],
        consumeOnSummon: true,
        heartbeat: Date.now(),
        lore: [
            ChatColor.RED + "生命值：" + ChatColor.WHITE + "999",
            ChatColor.GOLD + "免疫：火焰、岩浆、爆炸伤害",
            ChatColor.GRAY + "混合碰撞箱：Husk + 全程浮空隐形 Slime，命中任意一个都有效",
            ChatColor.GRAY + "低空飞行，近战玩家可以攻击到。",
            ChatColor.GRAY + "移动速度与玩家步行相当。",
            "",
            ChatColor.YELLOW + "攻击方式：",
            ChatColor.GRAY + "· 杀戮光环：6 格内持续点燃并每 0.1 秒造成 1 点伤害",
            ChatColor.GRAY + "· 大型火焰弹：12 tick 红色粒子激光预警，威力 4.5",
            ChatColor.GRAY + "· 连续发射大量小型火焰弹（每枚爆炸威力 1.75）",
            ChatColor.GRAY + "· 冲撞：8 tick 黄色粒子预警，30 格，命中 25 点伤害",
            ChatColor.GRAY + "· 远程命中 6 次后陷入 5 秒硬直（光环消失、近战易伤）",
            ChatColor.DARK_RED + "· 生命值低于 450 时引燃，5 秒后大爆炸（威力 10.0）",
            ChatColor.DARK_RED + "· 半血后：紫色龙息弹、蓝色巨型火龙卷、吸附激光",
            ChatColor.DARK_RED + "· 硬直结束时发动 45 格超级冲撞，结束时投掷末影水晶火球",
            ChatColor.DARK_RED + "· HP 归零：煤炭块无敌 + 东南西北 30 格召唤火种（20 HP）",
            ChatColor.DARK_RED + "· 火种阶段：20 秒后火焰漩涡回归，恢复剩余火种 ×100 HP",
            ChatColor.DARK_RED + "· 清除全部火种会立刻进入死亡自爆；剩余火种越少下次召唤越少",
            ChatColor.DARK_RED + "· 死亡时再次引燃，持续火球雨 + 最终爆炸（威力 13.0）"
        ],
        spawn: spawnInfernoFoehn
    };

    var hardBossDefinition = {
        id: HARD_BOSS_ID,
        name: HARD_BOSS_NAME,
        aliases: ["炎狱焚风-hard", "inferno_foehn_hard", "infernofoehn-hard", "hard"],
        consumeOnSummon: true,
        stickName: HARD_STICK_NAME,
        stickLore: [],
        heartbeat: Date.now(),
        lore: [],
        spawn: function (location, player) {
            return spawnInfernoFoehn(location, player, true);
        }
    };

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (!api) return;
            var defs = [bossDefinition, hardBossDefinition];
            for (var i = 0; i < defs.length; i++) {
                var def = defs[i];
                if (api !== lastRegistryApi || !api.get(def.id)) {
                    api.register(def);
                } else {
                    api.heartbeat(def.id);
                }
            }
            lastRegistryApi = api;
        } catch (e) {
            log.warn("InfernoFoehn 注册到 /call 框架失败：" + e);
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), function() {
        ensureRegistered();
    });

    // 脚本卸载 / 服务器关闭时停止 BGM，避免声音在重载后继续循环。
    // 卸载回调可能在异步线程，统一使用不调用 Bukkit 命令的反射停止路径。
    task.bindToUnload(function() {
        try {
            bgmShuttingDown = true;
            stopBgmForUnload();
        } catch (e) { }
    });

    log.info("InfernoFoehn 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤烈焰棒。");
})();
