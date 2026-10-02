/*
 * Sharpshooter.js —— 自定义 BOSS「神射手」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 神射手
 * 召唤方式：手持名为「神射手」的绿宝石右键地面 → 6 秒倒计时 → spawn
 *
 * 机制摘要：
 *   外观：真实流浪者（Stray）本体，头 / 胸 / 腿 / 脚 全套染白皮革甲，主手 弓
 *   数据：HP 100；移动速度 0.24 格/tick（玩家步行约 0.215，略快约 11%）；
 *         击退抗性 1.0（完全免疫击退）；免疫火焰 / 爆炸 / 摔落等环境伤害，
 *         只接受玩家造成的伤害；白天不会着火（逐 tick 清火焰 + 取消火焰伤害）
 *   走位：远程放风筝 —— 玩家近于 6 格后退、远于 16 格靠近、中距离横向绕行
 *   弓箭（主武器，攻击冷却 6 秒，每次从四种箭里随机挑一种，不连续重复）：
 *     · 连射箭：一次 3 支箭，无视受击间隔（3 段伤害都会生效），单支 4 点；
 *               伤害较为均衡，可被盾牌防御
 *     · 爆裂箭：1 支带红色火焰尾迹的箭；命中处产生**不破坏地形**的爆炸（半径 3），
 *               伤害偏低；被炸到、真的掉血的玩家会被击飞；可被盾牌防御
 *     · 猛毒箭：瞄准 2 秒（绿色毒气蓄力）后射 1 支带绿色毒气尾迹的箭；
 *               命中并造成伤害的玩家 中毒 IV + 失明 2 秒；伤害偏低；可被盾牌防御
 *     · 禁锢箭：瞄准 2 秒（紫色粒子 + 警示线警告目标）后射 1 支紫色尾迹的箭；
 *               命中并造成伤害的玩家 缓慢 V 5 秒；伤害偏高；可被盾牌防御
 *   闪避：每 90 秒拥有一次「抵挡任意伤害来源」的机会 —— 触发时该次伤害无效、
 *         同时瞬移到远离玩家的有效落点并留下一团白色烟雾；触发后才开始 90 秒冷却
 *
 * 契约依据：《OpenJS脚本数据契约.md》v1.0.0
 *   - 第 2 节  IIFE + "use strict" 作用域隔离
 *   - 第 5 节  单 1 tick 主循环 + 主线程同步延迟队列（禁止 task.delay 触碰世界）
 *   - 第 7 节  投射物必须显式赋初速度、登记寿命并统一清理
 *   - M-1 跨引擎只共享 Java 值（注册只传基本值 + 函数）
 *   - M-2 事件注册推迟到主线程第一个 tick，避开并行加载抢锁
 *   - M-4 爆炸用 5 参数重载；本 BOSS 直接不用原版爆炸伤害（见 5.3）
 *   - M-5 world.spawn 必须传 Class.forName(...) 得到的 java.lang.Class
 *   - M-9a 枚举常量在顶层预检，避免「加载成功但技能期才抛错」
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Class = Java.type("java.lang.Class");
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var Color = Java.type("org.bukkit.Color");
    var LeatherArmorMeta = Java.type("org.bukkit.inventory.meta.LeatherArmorMeta");
    var Location = Java.type("org.bukkit.Location");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var GameMode = Java.type("org.bukkit.GameMode");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var ArrowPickupStatus = Java.type("org.bukkit.entity.AbstractArrow$PickupStatus");
    var ArrayList = Java.type("java.util.ArrayList");
    var UUIDClass = Java.type("java.util.UUID");

    // M-5：Java.type(...) 返回 Nashorn StaticClass，不能当 java.lang.Class 传给 world.spawn。
    var EntityClass = Class.forName("org.bukkit.entity.Entity");
    var StrayClass = Class.forName("org.bukkit.entity.Stray");
    var ArrowClass = Class.forName("org.bukkit.entity.Arrow");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var BOSS_ID = "sharpshooter";
    var BOSS_NAME = "神射手";
    var BOSS_ALIASES = ["神射", "marksman", "sharpshooter", "archer"];
    var BOSS_LORE = [
        "生命值：100",
        "全套染白皮革甲，手持弓（流浪者本体）",
        "免疫击退；免疫火焰、爆炸、摔落等环境伤害",
        "只接受玩家造成的伤害",
        "————————————————",
        "弓箭（攻击冷却 6 秒，四选一）：",
        "· 连射箭：一次 3 支箭，无视受击间隔，伤害均衡",
        "· 爆裂箭：红色火焰箭，命中处不破坏地形的爆炸 + 击飞掉血的玩家，伤害偏低",
        "· 猛毒箭：瞄准 2 秒，命中掉血的玩家 中毒 IV + 失明 2 秒，伤害偏低",
        "· 禁锢箭：瞄准 2 秒（紫色警示线锁定），命中掉血的玩家 缓慢 V 5 秒，伤害偏高",
        "以上箭矢均可被盾牌防御",
        "————————————————",
        "闪避：每 90 秒一次，抵挡任意一次伤害并瞬移远离玩家（白烟）"
    ];

    // 生命 / 移动
    var MAX_HEALTH = 100.0;
    var KNOCKBACK_RESISTANCE = 1.0;       // 需求：免疫击退（属性满值 = 完全免疫）
    // 速度：玩家步行速度属性 0.1 ≈ 0.215 格/tick。
    // 本 BOSS 由脚本逐 tick 位移移动（无 AI 实体不吃移动速度属性），
    // 因此 WALK_SPEED 的单位是 格/tick：0.24 ≈ 比玩家步行快约 11%，仍慢于疾跑（0.28）。
    var PLAYER_WALK_ATTRIBUTE = 0.1;
    var SPEED_MULTIPLIER = 1.11;
    var WALK_SPEED = 0.24;
    var MAX_STEP_UP = 1;                  // 逐 tick 位移时允许自动上台阶的格数
    var MAX_STEP_DOWN = 3;                // 允许跟随地形下落的格数
    // 放风筝走位
    var KEEP_DISTANCE = 6.0;              // 玩家近于此距离 → 后退
    var PREFERRED_RANGE = 16.0;           // 玩家远于此距离 → 靠近
    var STRAFE_SPEED = 0.09;              // 中距离横向绕行速度（格/tick）
    var STRAFE_FLIP_TICKS = 40;           // 每 2 秒换一次绕行方向
    var TARGET_RANGE = 48.0;              // 索敌半径
    var BAR_VIEW_RANGE = TARGET_RANGE;    // BossBar 显示半径
    var SPAWN_GROUND_SEARCH = 5;          // 生成点向下找地面的最大格数

    // 朝向：追击 / 行走时本体与头部都看向目标的视线高度
    var TARGET_EYE_HEIGHT = 1.6;          // 玩家眼睛大致高度
    var MAX_FACE_PITCH = 35.0;            // 抬头 / 低头最大角度，避免怪异姿势

    // 弓箭公共参数
    var ATTACK_COOLDOWN_TICKS = 120;      // 需求：攻击冷却 6 秒
    var ATTACK_MAX_RANGE = 26.0;          // 超过此距离不主动开火（仍会追击）
    var ATTACK_MIN_RANGE = 2.5;           // 贴脸时先拉开距离再射
    var ARROW_LIFE_TICKS = 120;           // 箭矢最长存活 tick（兜底清理）
    var ARROW_GRAVITY = 0.05;             // 原版箭矢重力，用于瞄准补偿
    var ARROW_HIT_RADIUS = 1.5;           // 逐 tick 兜底命中半径（防止高速穿透漏判）
    var ARROW_HIT_VERTICAL = 1.8;
    var ARROW_SPAWN_OFFSET = 0.8;         // 箭矢生成点相对眼睛的前移距离
    var AIM_HEIGHT = 1.2;                 // 瞄准点相对玩家脚底的高度（胸口）

    // 四种箭的权重（连射最常见，避免总是重复同一种）
    var VOLLEY_WEIGHT = 3;
    var EXPLOSIVE_WEIGHT = 2;
    var POISON_WEIGHT = 2;
    var BINDING_WEIGHT = 2;

    // 连射箭：一次 3 支，无视受击间隔（每次伤害前清无敌帧），可盾挡，伤害较为均衡
    var VOLLEY_ARROWS = 3;
    var VOLLEY_DAMAGE = 4.0;
    var VOLLEY_WINDUP_TICKS = 8;
    var VOLLEY_SHOT_GAP_TICKS = 3;        // 3 支之间的间隔（连成一串）
    var VOLLEY_SPEED = 1.95;
    var VOLLEY_SPREAD = 0.10;             // 横向散角（弧度）

    // 爆裂箭：红色火焰尾迹，不破坏地形的爆炸（半径 3），伤害偏低，掉血者被击飞
    var EXPLOSIVE_DAMAGE = 3.0;           // 直接命中
    var EXPLOSIVE_BLAST_DAMAGE = 3.0;     // 爆炸范围伤害
    var EXPLOSIVE_BLAST_RADIUS = 3.0;
    var EXPLOSIVE_WINDUP_TICKS = 8;
    var EXPLOSIVE_SPEED = 1.75;
    var EXPLOSIVE_LAUNCH_UP = 0.85;       // 击飞：向上
    var EXPLOSIVE_LAUNCH_OUT = 0.45;      // 击飞：向外

    // 猛毒箭：绿色毒气尾迹，瞄准 2 秒；中毒 IV + 失明 2 秒；伤害偏低
    var POISON_DAMAGE = 4.0;
    var POISON_AIM_TICKS = 40;            // 需求：瞄准 2 秒
    var POISON_SPEED = 1.8;
    var POISON_EFFECT_TICKS = 40;         // 需求：中毒 / 失明 2 秒
    var POISON_AMPLIFIER = 3;             // amplifier 3 = 中毒 IV
    var POISON_BLINDNESS_AMPLIFIER = 0;   // 失明 I

    // 禁锢箭：紫色尾迹 + 警示线，瞄准 2 秒；缓慢 V 5 秒；伤害偏高
    var BINDING_DAMAGE = 8.0;
    var BINDING_AIM_TICKS = 40;           // 需求：瞄准 2 秒
    var BINDING_SPEED = 2.1;
    var BINDING_SLOW_TICKS = 100;         // 需求：缓慢 5 秒
    var BINDING_SLOW_AMPLIFIER = 4;       // amplifier 4 = 缓慢 V
    var BINDING_LINE_POINTS = 14;         // 警示线粒子点数

    // 收招（射完之后的短暂硬直时间，用来做收弓动作）
    var RECOVER_TICKS = 10;

    // 闪避：每 90 秒一次，抵挡任意伤害来源 + 瞬移远离玩家
    var DODGE_COOLDOWN_TICKS = 1800;      // 需求：90 秒
    // 需求：闪避距离要远、以「远离玩家」为主（便于和其它自定义 BOSS 同场时的脱战定位）
    var DODGE_MIN_DISTANCE = 12.0;
    var DODGE_MAX_DISTANCE = 24.0;
    var DODGE_MAX_SPREAD = Math.PI * 0.45;  // 偏离「正后方」的最大角度（≈ ±40°）
    var DODGE_MIN_GAIN = 4.0;             // 落点必须比当前位置再远离参考玩家至少这么多格
    var DODGE_ATTEMPTS = 20;
    var DODGE_SEARCH_UP = 3;              // 落点高度解算：向上找的格数
    var DODGE_SEARCH_DOWN = 8;            // 落点高度解算：向下找的格数

    // 初始攻击时间（刚召唤出来给玩家一点准备时间）
    var INITIAL_ATTACK_DELAY_TICKS = 30;

    // 死亡
    var DEATH_SEQUENCE_TICKS = 30;

    // Tag / PDC key 必须带 BOSS id 前缀，避免跨 BOSS 冲突
    var BOSS_TAG = "sharpshooter_boss";
    var ARROW_TAG = "sharpshooter_arrow";
    var bossKey = new NamespacedKey(plugin, "sharpshooter_boss_type");
    var barKey = new NamespacedKey(plugin, "sharpshooter_bar");

    // 箭矢种类标识
    var KIND_VOLLEY = "volley";
    var KIND_EXPLOSIVE = "explosive";
    var KIND_POISON = "poison";
    var KIND_BINDING = "binding";

    // 需要免疫的伤害原因（玩家造成的伤害不受此表影响）
    var IGNORED_CAUSE_LIST = "|LAVA|HOT_FLOOR|MELTING|FALL|DROWNING|SUFFOCATION|STARVATION"
        + "|CRAMMING|CONTACT|POISON|WITHER|MAGIC|DRAGON_BREATH|CAMPFIRE|FREEZE|LIGHTNING"
        + "|SONIC_BOOM|VOID|";

    // -----------------------------------------------------------------------
    // 枚举 / 常量预检（M-9a）
    // 写错常量名时 /oj reload 阶段就会报加载错误，而不是等到技能释放那一刻。
    // -----------------------------------------------------------------------
    var PREFLIGHT_CONSTANTS = [
        String(Material.LEATHER_HELMET), String(Material.LEATHER_CHESTPLATE),
        String(Material.LEATHER_LEGGINGS), String(Material.LEATHER_BOOTS),
        String(Material.BOW), String(Material.EMERALD), String(Material.SHIELD),
        String(Particle.CRIT), String(Particle.FLAME), String(Particle.SMALL_FLAME),
        String(Particle.LARGE_SMOKE), String(Particle.SMOKE), String(Particle.CLOUD),
        String(Particle.SOUL), String(Particle.ITEM_SLIME), String(Particle.WITCH),
        String(Particle.DRAGON_BREATH), String(Particle.PORTAL),
        String(Particle.EXPLOSION_EMITTER), String(Particle.EXPLOSION),
        String(Particle.END_ROD), String(Particle.SWEEP_ATTACK),
        String(Sound.ENTITY_ARROW_SHOOT), String(Sound.ENTITY_ARROW_HIT),
        String(Sound.ENTITY_GENERIC_EXPLODE), String(Sound.ITEM_SHIELD_BLOCK),
        String(Sound.ENTITY_ENDERMAN_TELEPORT), String(Sound.ENTITY_SKELETON_DEATH),
        String(Sound.ENTITY_SKELETON_HURT), String(Sound.ENTITY_SKELETON_AMBIENT),
        String(Sound.ENTITY_SPLASH_POTION_BREAK), String(Sound.ENTITY_ELDER_GUARDIAN_CURSE),
        String(Sound.ITEM_CROSSBOW_LOADING_MIDDLE), String(Sound.ITEM_CROSSBOW_LOADING_END),
        String(Sound.BLOCK_NOTE_BLOCK_PLING), String(Sound.BLOCK_ANVIL_LAND),
        String(PotionEffectType.SLOWNESS), String(PotionEffectType.WEAKNESS),
        String(PotionEffectType.POISON), String(PotionEffectType.BLINDNESS),
        String(Attribute.MAX_HEALTH), String(Attribute.KNOCKBACK_RESISTANCE),
        String(Attribute.MOVEMENT_SPEED), String(Attribute.ATTACK_DAMAGE),
        String(BarColor.GREEN), String(BarStyle.SOLID), String(GameMode.SPECTATOR),
        String(PersistentDataType.STRING)
    ];

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var activeBosses = {};      // uuid -> boss 状态对象
    var trackedArrows = {};     // arrowUuid -> 在飞箭矢登记表（契约 6.2 的同类结构）
    var syncDelayedTasks = [];  // 契约 5.1：主线程同步延迟队列
    var globalTick = 0;

    // 头部旋转是否可以直接通过 NMS 设置（Paper 的 CraftEntity#getHandle()）。
    //   null = 还没试过，true = 可用，false = 不可用（退化为 setRotation + lookAt）
    var headRotationViaNms = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function logError(tag, e) {
        // 契约 9.2：异常日志必须带 e.stack，不能只写 e。
        log.error(tag + "：" + e + (e && e.stack ? "\n" + e.stack : ""));
    }

    function clamp(value, lo, hi) {
        return value < lo ? lo : (value > hi ? hi : value);
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
                    logError("Sharpshooter 延迟任务异常", e);
                }
            } else {
                syncDelayedTasks.push(current[i]);
            }
        }
    }

    function getAttributeSafe(entity, attribute) {
        try {
            var inst = entity.getAttribute(attribute);
            if (inst != null) return inst;
        } catch (ignored) { }
        try {
            entity.registerAttribute(attribute);
            return entity.getAttribute(attribute);
        } catch (ignored2) { }
        return null;
    }

    // M-3：spawnParticle 的 6 参数重载在 Nashorn 下有歧义，统一走 7 参数并强制 double。
    function spawnParticleSafe(world, particle, loc, count, ox, oy, oz, extra) {
        try {
            world.spawnParticle(particle, loc, count, ox + 0.0, oy + 0.0, oz + 0.0, extra + 0.0);
        } catch (ignored) { }
    }

    function playSoundSafe(world, loc, sound, volume, pitch) {
        try {
            world.playSound(loc, sound, volume, pitch);
        } catch (ignored) { }
    }

    function isEngageablePlayer(player) {
        // 创造模式玩家也纳入索敌：创造模式打不动是原版机制，
        // 但 BOSS 仍然要追击 / 释放技能，方便在练功房里直接观察表现。
        if (player == null) return false;
        try {
            if (!player.isOnline() || player.isDead()) return false;
            return player.getGameMode() !== GameMode.SPECTATOR;
        } catch (e) {
            return false;
        }
    }

    function findNearestPlayer(boss) {
        var best = null;
        var bestDist = TARGET_RANGE * TARGET_RANGE;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                var d = p.getLocation().distanceSquared(boss.carrier.getLocation());
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
        } catch (e) {
            logError("Sharpshooter 查找最近玩家异常", e);
        }
        return best;
    }

    function getBossByEntity(entity) {
        if (entity == null) return null;
        try {
            if (!entity.getScoreboardTags().contains(BOSS_TAG)) return null;
            var uuid = String(entity.getUniqueId().toString());
            return activeBosses[uuid] == null ? null : activeBosses[uuid];
        } catch (e) {
            return null;
        }
    }

    function isIgnoredDamageCause(cause) {
        if (cause == null) return false;
        var n = String(cause.name());
        if (n.indexOf("FIRE") >= 0 || n.indexOf("EXPLOSION") >= 0) return true;
        return IGNORED_CAUSE_LIST.indexOf("|" + n + "|") >= 0;
    }

    function resolveGroundY(world, x, y, z) {
        // 以给定 Y 为基准向下找实体方块；找不到就用原 Y（交给脚本的 Y 解算处理）
        var bx = Math.floor(x);
        var bz = Math.floor(z);
        var top = Math.floor(y);
        try {
            if (world.getBlockAt(bx, top - 1, bz).getType().isSolid()) return top;
        } catch (ignored) { }
        for (var dy = 1; dy <= SPAWN_GROUND_SEARCH; dy++) {
            try {
                if (world.getBlockAt(bx, top - 1 - dy, bz).getType().isSolid()) return top - dy;
            } catch (ignored2) {
                break;
            }
        }
        return top;
    }

    // 落点解算：在候选列上找一个「脚下实心 + 身体两格净空」的 Y（找不到返回 null）
    function findStandY(world, x, z, currentY, upRange, downRange) {
        try {
            var bx = Math.floor(x);
            var bz = Math.floor(z);
            var base = Math.floor(currentY);
            for (var dy = upRange; dy >= -downRange; dy--) {
                var y = base + dy;
                if (world.getBlockAt(bx, y - 1, bz).getType().isSolid()
                        && !world.getBlockAt(bx, y, bz).getType().isSolid()
                        && !world.getBlockAt(bx, y + 1, bz).getType().isSolid()) {
                    return y;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // 走到目标格时该站在哪一层：先上台阶（最多 MAX_STEP_UP 格），再下台阶（最多 MAX_STEP_DOWN 格）
    function resolveWalkY(world, x, currentY, z) {
        return findStandY(world, x, z, currentY, MAX_STEP_UP, MAX_STEP_DOWN);
    }

    function hasLineOfSight(boss, targetLocation) {
        // 简单遮挡检查：从眼睛向目标点做一次方块射线，命中方块说明被挡住
        try {
            var eye = boss.carrier.getEyeLocation();
            var dir = new Vector(targetLocation.getX() - eye.getX(),
                targetLocation.getY() - eye.getY(),
                targetLocation.getZ() - eye.getZ());
            var dist = dir.length();
            if (dist < 0.001) return true;
            dir.normalize();
            var hit = boss.world.rayTraceBlocks(eye, dir, dist);
            return hit == null;
        } catch (e) {
            return true;
        }
    }

    // -----------------------------------------------------------------------
    // 生命周期：生成 / 清理
    // -----------------------------------------------------------------------
    function createWhiteLeatherPiece(material) {
        var stack = new ItemStack(material);
        try {
            var meta = stack.getItemMeta();
            if (meta != null && meta instanceof LeatherArmorMeta) {
                // 需求：皮革甲已染色，颜色为白色
                meta.setColor(Color.WHITE);
                stack.setItemMeta(meta);
            }
        } catch (e) {
            logError("Sharpshooter 皮革甲染色失败", e);
        }
        return stack;
    }

    function equipSharpshooter(carrier) {
        try {
            var equipment = carrier.getEquipment();
            if (equipment == null) return;
            equipment.setHelmet(createWhiteLeatherPiece(Material.LEATHER_HELMET));
            equipment.setChestplate(createWhiteLeatherPiece(Material.LEATHER_CHESTPLATE));
            equipment.setLeggings(createWhiteLeatherPiece(Material.LEATHER_LEGGINGS));
            equipment.setBoots(createWhiteLeatherPiece(Material.LEATHER_BOOTS));
            equipment.setItemInMainHand(new ItemStack(Material.BOW));
            // 掉落率为 0：BOSS 死亡不掉装备
            equipment.setHelmetDropChance(0.0);
            equipment.setChestplateDropChance(0.0);
            equipment.setLeggingsDropChance(0.0);
            equipment.setBootsDropChance(0.0);
            equipment.setItemInMainHandDropChance(0.0);
        } catch (e) {
            logError("Sharpshooter 穿戴白色皮革甲 / 弓失败", e);
        }
    }

    function createBossBar() {
        var bar = null;
        try {
            Bukkit.removeBossBar(barKey);
            bar = Bukkit.createBossBar(barKey, BOSS_NAME, BarColor.GREEN, BarStyle.SOLID);
            bar.setProgress(1.0);
            bar.setVisible(true);
        } catch (e) {
            logError("Sharpshooter 创建 BossBar 失败", e);
            bar = null;
        }
        return bar;
    }

    function spawnSharpshooter(location, player) {
        try {
            if (location == null) return false;
            var world = location.getWorld();
            if (world == null) return false;

            var groundY = resolveGroundY(world, location.getX(), location.getY(), location.getZ());
            var spawnLoc = new Location(world, location.getX(), groundY, location.getZ(), 0, 0);

            // M-5：必须传 Class.forName(...) 得到的 java.lang.Class。
            var carrier = world.spawn(spawnLoc, StrayClass);
            if (carrier == null) {
                logError("Sharpshooter 生成失败", "world.spawn 返回 null");
                return false;
            }

            carrier.setAI(false);              // 移动 / 攻击完全由脚本接管
            carrier.setInvisible(false);       // 本体就是要显示出来的白甲流浪者
            // 重力关闭：Y 轴完全由 resolveWalkY 控制，避免逐 tick 位移与重力互相抖动
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.setCustomName(ChatColor.GREEN + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            try { carrier.setVisualFire(false); } catch (ignored) { }
            carrier.addScoreboardTag(BOSS_TAG);
            carrier.getPersistentDataContainer().set(bossKey, PersistentDataType.STRING, BOSS_ID);

            var maxHealth = getAttributeSafe(carrier, Attribute.MAX_HEALTH);
            if (maxHealth != null) maxHealth.setBaseValue(MAX_HEALTH);
            var knockback = getAttributeSafe(carrier, Attribute.KNOCKBACK_RESISTANCE);
            if (knockback != null) knockback.setBaseValue(KNOCKBACK_RESISTANCE);
            // 移动速度属性：本 BOSS 无 AI，属性不参与移动；填一个「略快于步行」的值只为可读性。
            var moveSpeed = getAttributeSafe(carrier, Attribute.MOVEMENT_SPEED);
            if (moveSpeed != null) moveSpeed.setBaseValue(PLAYER_WALK_ATTRIBUTE * SPEED_MULTIPLIER);
            // 攻击力基础值归零：本 BOSS 无 AI，不会发动原版攻击；所有伤害都由脚本结算。
            var attackDamage = getAttributeSafe(carrier, Attribute.ATTACK_DAMAGE);
            if (attackDamage != null) attackDamage.setBaseValue(0.0);
            try {
                carrier.setHealth(MAX_HEALTH);
            } catch (e) {
                logError("Sharpshooter 设置生命值失败", e);
            }
            equipSharpshooter(carrier);

            var uuid = String(carrier.getUniqueId().toString());
            var bar = createBossBar();
            if (bar != null && player != null) {
                try { bar.addPlayer(player); } catch (ignored) { }
            }

            activeBosses[uuid] = {
                id: BOSS_ID,
                uuid: uuid,
                carrier: carrier,
                world: world,
                bar: bar,
                barKey: barKey,
                barTick: 0,
                spawnTick: globalTick,
                target: null,
                action: null,
                nextAttackTick: globalTick + INITIAL_ATTACK_DELAY_TICKS,
                lastKind: null,
                strafeDir: 1.0,
                nextStrafeFlipTick: globalTick + STRAFE_FLIP_TICKS,
                faceYaw: 0.0,
                facePitch: 0.0,
                dodgeReady: true,               // 需求：每 90 秒一次，触发后才进冷却
                nextDodgeTick: 0,
                dodgeCount: 0,
                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null
            };

            playSoundSafe(world, spawnLoc, Sound.ENTITY_SKELETON_AMBIENT, 1.4, 0.9);
            playSoundSafe(world, spawnLoc, Sound.ENTITY_ARROW_SHOOT, 1.2, 0.8);
            spawnParticleSafe(world, Particle.CLOUD, spawnLoc, 25, 0.9, 1.0, 0.9, 0.04);
            spawnParticleSafe(world, Particle.CRIT, spawnLoc, 20, 1.0, 1.0, 1.0, 0.12);
            log.info("Sharpshooter 生成成功：" + uuid + " @ " + world.getName()
                + " (" + Math.round(spawnLoc.getX()) + "," + Math.round(spawnLoc.getY())
                + "," + Math.round(spawnLoc.getZ()) + ")");
            return true;
        } catch (e) {
            logError("Sharpshooter 生成失败", e);
            return false;
        }
    }

    function removeBossBar(boss) {
        try {
            if (boss.bar != null) {
                boss.bar.removeAll();
                boss.bar.setVisible(false);
            }
            Bukkit.removeBossBar(boss.barKey);
        } catch (ignored) { }
    }

    function removeBossArrows(bossUuid) {
        var uuids = Object.keys(trackedArrows);
        for (var i = 0; i < uuids.length; i++) {
            var entry = trackedArrows[uuids[i]];
            if (entry == null) continue;
            if (bossUuid != null && String(entry.bossUuid) !== String(bossUuid)) continue;
            try {
                if (entry.proj != null) entry.proj.remove();
            } catch (ignored) { }
            delete trackedArrows[uuids[i]];
        }
    }

    function cleanupBoss(boss) {
        if (boss == null) return;
        removeBossBar(boss);
        removeBossArrows(boss.uuid);
        try {
            if (boss.carrier != null && boss.carrier.isValid() && !boss.carrier.isDead()) {
                boss.carrier.remove();
            }
        } catch (ignored) { }
        delete activeBosses[boss.uuid];
        log.info("Sharpshooter 已清理 BOSS：" + boss.uuid);
    }

    // 本脚本实例当前活着的载具 UUID 集合：
    // 周期性 cleanupOrphans 必须跳过这些实体，否则会把正在战斗的 BOSS 一起删掉（实测 M-15）。
    function isOwnedEntity(uuid) {
        return activeBosses[String(uuid)] != null;
    }

    function removeTaggedEntities(world, tag) {
        var removed = 0;
        try {
            var it = world.getEntitiesByClass(EntityClass).iterator();
            while (it.hasNext()) {
                var ent = it.next();
                if (!ent.getScoreboardTags().contains(tag)) continue;
                if (isOwnedEntity(String(ent.getUniqueId().toString()))) continue;
                ent.remove();
                removed++;
            }
        } catch (e) {
            logError("Sharpshooter 清理带 Tag 实体异常", e);
        }
        return removed;
    }

    // 在飞箭矢：只清理「没有活着 BOSS 认领」的那些
    function removeOrphanArrows(world) {
        var removed = 0;
        try {
            var it = world.getEntitiesByClass(ArrowClass).iterator();
            var toRemove = [];
            while (it.hasNext()) {
                var arrow = it.next();
                if (!arrow.getScoreboardTags().contains(ARROW_TAG)) continue;
                var uuid = String(arrow.getUniqueId().toString());
                var entry = trackedArrows[uuid];
                if (entry != null && activeBosses[entry.bossUuid] != null) continue;
                toRemove.push(arrow);
                delete trackedArrows[uuid];
            }
            for (var i = 0; i < toRemove.length; i++) {
                try { toRemove[i].remove(); } catch (ignored) { }
                removed++;
            }
        } catch (e) {
            logError("Sharpshooter 清理孤儿箭矢异常", e);
        }
        return removed;
    }

    // 本 BOSS 只使用一个固定 key 的 KeyedBossBar，因此清理孤儿血条不需要遍历。
    // 实测（M-13）：Bukkit.getBossBars() 在 Nashorn 下返回非公开集合实现，
    // bars.size() / bars.iterator() 都不是函数，所以改用按 Key 移除。
    function cleanupOrphanBossBars() {
        if (Object.keys(activeBosses).length > 0) return;   // 本实例还有活着的 BOSS，血条在用
        try {
            Bukkit.removeBossBar(barKey);
        } catch (e) {
            logError("Sharpshooter 清理孤儿 BossBar 异常", e);
        }
    }

    // 脚本重载 / 启动时清理上一次实例遗留的实体、箭矢与血条（M-2：主线程第一个 tick 之后）
    function cleanupOrphans() {
        try {
            var removed = 0;
            var worlds = Bukkit.getWorlds();
            for (var i = 0; i < worlds.size(); i++) {
                var world = worlds.get(i);
                removed += removeTaggedEntities(world, BOSS_TAG);
                removed += removeOrphanArrows(world);
            }
            cleanupOrphanBossBars();
            if (removed > 0) log.info("Sharpshooter 清理孤儿实体 / 箭矢：" + removed + " 个。");
        } catch (e) {
            logError("Sharpshooter 清理孤儿实体异常", e);
        }
    }

    // -----------------------------------------------------------------------
    // 外观 / 朝向 / 移动（放风筝）
    // -----------------------------------------------------------------------
    // 让本体 + 头部一起看向某个点（含俯仰），返回本次算出的 yaw。
    //
    // 三个层次，逐层兜底：
    //   1) Entity#setRotation(yaw,pitch) —— 设置实体本体朝向（一定可用）；
    //   2) Mob#lookAt(x,y,z)            —— 让 LookControl 把头部转向该点；
    //   3) NMS getHandle().setYHeadRot / setYBodyRot / setXRot
    //      —— 无 AI 实体不会被 LookControl 推进头部旋转，直接写 NMS 字段最保险，
    //         失败一次就永久退化为前两层（不会刷屏报错）。
    //
    // 返回值必须被调用方拿去 teleport：teleport(Location) 会连同 yaw/pitch 一起写入实体，
    // 若沿用 teleport 之前读到的旧 yaw，就会把刚设置好的朝向又覆盖回旧值（实测 M-16）。
    function lookAtPoint(boss, targetX, targetY, targetZ) {
        var yaw = boss.carrier.getLocation().getYaw();
        var pitch = 0.0;
        try {
            var loc = boss.carrier.getLocation();
            var dx = targetX - loc.getX();
            var dz = targetZ - loc.getZ();
            var dy = targetY - (loc.getY() + TARGET_EYE_HEIGHT);
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            yaw = Math.atan2(-dx, dz) * 180.0 / Math.PI;
            pitch = (horizontal < 0.001) ? 0.0
                : clamp(-Math.atan2(dy, horizontal) * 180.0 / Math.PI, -MAX_FACE_PITCH, MAX_FACE_PITCH);

            try { boss.carrier.setRotation(yaw, pitch); } catch (ignored) { }
            try { boss.carrier.lookAt(targetX, targetY, targetZ); } catch (ignored) { }

            if (headRotationViaNms !== false) {
                try {
                    var handle = boss.carrier.getHandle();
                    handle.setYHeadRot(yaw);
                    handle.setYBodyRot(yaw);
                    handle.setXRot(pitch);
                    if (headRotationViaNms === null) {
                        headRotationViaNms = true;
                        log.info("Sharpshooter 头部朝向：已启用 NMS 直接写入（setYHeadRot/setYBodyRot）。");
                    }
                } catch (e) {
                    if (headRotationViaNms === null) {
                        headRotationViaNms = false;
                        log.warn("Sharpshooter 头部朝向：NMS 通道不可用，退化为 setRotation + lookAt（"
                            + e + "）。");
                    }
                }
            }
        } catch (e) {
            logError("Sharpshooter 朝向计算异常", e);
        }
        boss.faceYaw = yaw;
        boss.facePitch = pitch;
        return yaw;
    }

    function faceTarget(boss, targetLocation) {
        return lookAtPoint(boss, targetLocation.getX(),
            targetLocation.getY() + TARGET_EYE_HEIGHT, targetLocation.getZ());
    }

    // 尝试沿某个水平方向走一步；走不进去（前方是墙 / 无地面）返回 false
    function stepToward(boss, dirX, dirZ, speed) {
        try {
            var loc = boss.carrier.getLocation();
            var nextX = loc.getX() + dirX * speed;
            var nextZ = loc.getZ() + dirZ * speed;
            var nextY = resolveWalkY(boss.world, nextX, loc.getY(), nextZ);
            if (nextY == null) return false;
            boss.carrier.teleport(new Location(boss.world, nextX, nextY, nextZ,
                boss.faceYaw, boss.facePitch));
            return true;
        } catch (e) {
            return false;
        }
    }

    function updateMovement(boss, target) {
        if (boss.action != null) return;   // 出招期间站定，给玩家反应时间
        if (target == null) return;
        try {
            var loc = boss.carrier.getLocation();
            var tgt = target.getLocation();
            var dx = tgt.getX() - loc.getX();
            var dz = tgt.getZ() - loc.getZ();
            var dist = Math.sqrt(dx * dx + dz * dz);
            // 追击时始终看向目标玩家（本体 + 头部 + 俯仰）
            lookAtPoint(boss, tgt.getX(), tgt.getY() + TARGET_EYE_HEIGHT, tgt.getZ());
            if (dist < 0.0001) return;

            var ux = dx / dist;
            var uz = dz / dist;

            if (dist > PREFERRED_RANGE) {
                // 太远：靠近
                stepToward(boss, ux, uz, WALK_SPEED);
                return;
            }
            if (dist < KEEP_DISTANCE) {
                // 太近：后退拉弓距离
                stepToward(boss, -ux, -uz, WALK_SPEED);
                return;
            }
            // 中距离：横向绕行（一段时间换一次方向），绕不动就换另一边
            if (globalTick >= boss.nextStrafeFlipTick) {
                boss.strafeDir = -boss.strafeDir;
                boss.nextStrafeFlipTick = globalTick + STRAFE_FLIP_TICKS;
            }
            var sideX = -uz * boss.strafeDir;
            var sideZ = ux * boss.strafeDir;
            if (!stepToward(boss, sideX, sideZ, STRAFE_SPEED)) {
                boss.strafeDir = -boss.strafeDir;
                stepToward(boss, -sideX, -sideZ, STRAFE_SPEED);
            }
        } catch (e) {
            logError("Sharpshooter 移动异常", e);
        }
    }

    function snapToGround(boss) {
        try {
            var loc = boss.carrier.getLocation();
            var groundY = resolveWalkY(boss.world, loc.getX(), loc.getY(), loc.getZ());
            if (groundY == null) groundY = resolveGroundY(boss.world, loc.getX(), loc.getY(), loc.getZ());
            if (Math.abs(loc.getY() - groundY) > 0.001) {
                boss.carrier.teleport(new Location(boss.world, loc.getX(), groundY, loc.getZ(),
                    loc.getYaw(), 0));
            }
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 盾牌与伤害底层
    // -----------------------------------------------------------------------
    // 玩家是否"真的"在用盾牌格挡：举盾中 且 盾牌不在冷却中。
    function isPlayerGuarding(player) {
        if (player == null) return false;
        var blocking = false;
        try {
            blocking = player.isBlocking();
        } catch (e) {
            return false;
        }
        if (!blocking) return false;
        try {
            if (player.getCooldown(Material.SHIELD) > 0) return false;
        } catch (ignored) { }
        return true;
    }

    function playShieldBlockFeedback(player) {
        try {
            var loc = player.getLocation();
            var world = loc.getWorld();
            if (world == null) return;
            playSoundSafe(world, loc, Sound.ITEM_SHIELD_BLOCK, 1.3, 1.0);
            var dir = loc.getDirection().normalize().multiply(-1.0);
            for (var i = 0; i < 10; i++) {
                spawnParticleSafe(world, Particle.CRIT, new Location(world,
                    loc.getX() + dir.getX() * 0.7 + (Math.random() - 0.5) * 0.5,
                    loc.getY() + 1.2 + (Math.random() - 0.5) * 0.5,
                    loc.getZ() + dir.getZ() * 0.7 + (Math.random() - 0.5) * 0.5),
                    1, 0.0, 0.0, 0.0, 0.05);
            }
        } catch (ignored) { }
    }

    // 对玩家造成伤害，返回"是否真的掉血"。
    // 创造模式 / 无敌 / 已死亡的玩家会返回 false —— 中毒 / 缓慢 / 击飞等都以它为判据。
    function dealPlayerDamage(player, amount, boss) {
        var before = -1.0;
        try {
            before = player.getHealth();
        } catch (e) {
            return false;
        }
        try { player.setNoDamageTicks(0); } catch (ignored) { }   // 清无敌帧（连射箭的"无视受击间隔"）
        try {
            if (boss != null && boss.carrier != null && boss.carrier.isValid()) {
                player.damage(amount, boss.carrier);
            } else {
                player.damage(amount);
            }
        } catch (e) {
            logError("Sharpshooter 造成伤害失败", e);
            return false;
        }
        try {
            return player.getHealth() < before - 0.001;
        } catch (e) {
            return false;
        }
    }

    function pushPlayer(player, dirX, dirY, dirZ) {
        try {
            player.setVelocity(new Vector(dirX, dirY, dirZ));
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 单目标结算：返回 "blocked" / "hit" / "noeffect"
    // -----------------------------------------------------------------------
    function arrowDamageFor(kind) {
        if (kind === KIND_VOLLEY) return VOLLEY_DAMAGE;
        if (kind === KIND_EXPLOSIVE) return EXPLOSIVE_DAMAGE;
        if (kind === KIND_POISON) return POISON_DAMAGE;
        if (kind === KIND_BINDING) return BINDING_DAMAGE;
        return 0.0;
    }

    // 连射 / 猛毒 / 禁锢 三种箭的命中结算（爆裂箭走爆炸结算）
    function resolveArrowHitPlayer(boss, kind, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, arrowDamageFor(kind), boss);
        if (!dealt) return "noeffect";

        if (kind === KIND_POISON) {
            // 需求：对损失生命值的玩家施加 中毒 IV + 失明，持续 2 秒
            try {
                player.addPotionEffect(new PotionEffect(PotionEffectType.POISON,
                    POISON_EFFECT_TICKS, POISON_AMPLIFIER, false, true, true));
                player.addPotionEffect(new PotionEffect(PotionEffectType.BLINDNESS,
                    POISON_EFFECT_TICKS, POISON_BLINDNESS_AMPLIFIER, false, true, true));
            } catch (ignored) { }
            try {
                player.sendMessage(ChatColor.DARK_GREEN + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                    + "猛毒箭命中：中毒 IV + 失明 " + (POISON_EFFECT_TICKS / 20) + " 秒。");
                player.sendActionBar(ChatColor.DARK_GREEN + "中毒 IV" + ChatColor.GRAY + " + "
                    + ChatColor.DARK_GRAY + "失明 " + (POISON_EFFECT_TICKS / 20) + "s");
            } catch (ignored) { }
        } else if (kind === KIND_BINDING) {
            // 需求：对损失生命值的玩家施加 缓慢 V，持续 5 秒
            try {
                player.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,
                    BINDING_SLOW_TICKS, BINDING_SLOW_AMPLIFIER, false, true, true));
            } catch (ignored) { }
            try {
                player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                    + "禁锢箭命中：缓慢 V " + (BINDING_SLOW_TICKS / 20) + " 秒。");
                player.sendActionBar(ChatColor.DARK_PURPLE + "禁锢！" + ChatColor.GRAY + "缓慢 V "
                    + (BINDING_SLOW_TICKS / 20) + "s");
            } catch (ignored) { }
        }
        return "hit";
    }

    // 爆裂箭爆炸的逐玩家结算：可盾挡；真的掉血的玩家被击飞
    function resolveExplosiveHitPlayer(boss, player, center) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, EXPLOSIVE_BLAST_DAMAGE, boss);
        if (!dealt) return "noeffect";
        // 需求：击飞「损失生命值的玩家」
        var outX = 0.0;
        var outZ = 0.0;
        try {
            var pl = player.getLocation();
            var dx = pl.getX() - center.getX();
            var dz = pl.getZ() - center.getZ();
            var len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.001) {
                outX = dx / len;
                outZ = dz / len;
            }
        } catch (ignored) { }
        pushPlayer(player, outX * EXPLOSIVE_LAUNCH_OUT, EXPLOSIVE_LAUNCH_UP,
            outZ * EXPLOSIVE_LAUNCH_OUT);
        try {
            player.sendMessage(ChatColor.RED + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "爆裂箭把你炸飞了！");
        } catch (ignored) { }
        return "hit";
    }

    // -----------------------------------------------------------------------
    // 箭矢：生成 / 尾迹 / 命中
    // -----------------------------------------------------------------------
    function aimDirection(boss, target, speed) {
        // 朝目标胸口瞄准，并按原版重力做一次落点补偿（否则远距离会打低）
        var eye = boss.carrier.getEyeLocation();
        var tgt = target.getLocation();
        var tx = tgt.getX();
        var ty = tgt.getY() + AIM_HEIGHT;
        var tz = tgt.getZ();
        var dx = tx - eye.getX();
        var dy = ty - eye.getY();
        var dz = tz - eye.getZ();
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var flightTicks = dist / Math.max(0.1, speed);
        var drop = 0.5 * ARROW_GRAVITY * flightTicks * flightTicks;
        var dir = new Vector(dx, dy + drop, dz);
        if (dir.lengthSquared() < 1.0e-6) return new Vector(0, 0, 1);
        return dir.normalize();
    }

    // 让箭矢模型朝向真实飞行方向。
    // 实测（客户端反馈）：只 setVelocity 不会更新实体的 yRot/xRot，
    // 箭矢模型会一直保持出生时的朝向（看起来没指向玩家），必须显式设置。
    function orientArrow(proj) {
        try {
            var v = proj.getVelocity();
            var horizontal = Math.sqrt(v.getX() * v.getX() + v.getZ() * v.getZ());
            var yaw = Math.atan2(-v.getX(), v.getZ()) * 180.0 / Math.PI;
            var pitch;
            if (horizontal < 0.001) {
                pitch = (v.getY() >= 0) ? -90.0 : 90.0;
            } else {
                pitch = -Math.atan2(v.getY(), horizontal) * 180.0 / Math.PI;
            }
            proj.setRotation(yaw, pitch);
        } catch (ignored) { }
    }

    function spawnBossArrow(boss, kind, dir, speed) {
        try {
            var world = boss.world;
            var eye = boss.carrier.getEyeLocation();
            var loc = eye.clone().add(dir.clone().multiply(ARROW_SPAWN_OFFSET));
            var arrow = world.spawn(loc, ArrowClass);
            if (arrow == null) return null;
            arrow.setShooter(boss.carrier);
            // 原版伤害归零：命中判定与伤害全部由脚本结算，避免双重结算与盾牌物理弹开
            arrow.setDamage(0.0);
            // 实测（本机探针）：Bukkit 1.21.8 的 Arrow / AbstractArrow 并没有
            // setKnockback(int)，击退一律由脚本自己控制；这里只关掉暴击与穿透。
            try { arrow.setPierceLevel(0); } catch (ignored) { }
            try { arrow.setCritical(false); } catch (ignored) { }
            try { arrow.setPickupStatus(ArrowPickupStatus.DISALLOWED); } catch (ignored) { }
            try { arrow.setFireTicks(0); } catch (ignored) { }
            arrow.setVelocity(dir.clone().multiply(speed));
            orientArrow(arrow);          // 模型朝向 = 飞行方向（否则会保持出生朝向）
            arrow.addScoreboardTag(ARROW_TAG);
            var uuid = String(arrow.getUniqueId().toString());
            trackedArrows[uuid] = {
                proj: arrow,
                kind: kind,
                bossUuid: boss.uuid,
                life: ARROW_LIFE_TICKS,
                resolved: false
            };
            return arrow;
        } catch (e) {
            logError("Sharpshooter 生成箭矢失败", e);
            return null;
        }
    }

    function spawnArrowTrail(entry, loc) {
        try {
            var world = loc.getWorld();
            if (world == null) return;
            if (entry.kind === KIND_EXPLOSIVE) {
                // 需求：爆裂箭带「红色火焰」粒子
                spawnParticleSafe(world, Particle.FLAME, loc, 3, 0.08, 0.08, 0.08, 0.01);
                spawnParticleSafe(world, Particle.SMALL_FLAME, loc, 2, 0.06, 0.06, 0.06, 0.0);
            } else if (entry.kind === KIND_POISON) {
                // 需求：猛毒箭带「绿色毒气」粒子
                spawnParticleSafe(world, Particle.ITEM_SLIME, loc, 3, 0.08, 0.08, 0.08, 0.0);
                if (globalTick % 3 === 0) {
                    spawnParticleSafe(world, Particle.SMOKE, loc, 1, 0.05, 0.05, 0.05, 0.002);
                }
            } else if (entry.kind === KIND_BINDING) {
                // 需求：禁锢箭带「紫色」粒子
                spawnParticleSafe(world, Particle.DRAGON_BREATH, loc, 2, 0.06, 0.06, 0.06, 0.004);
                spawnParticleSafe(world, Particle.WITCH, loc, 3, 0.1, 0.1, 0.1, 0.0);
            } else {
                if (globalTick % 2 === 0) {
                    spawnParticleSafe(world, Particle.CRIT, loc, 1, 0.04, 0.04, 0.04, 0.0);
                }
            }
        } catch (ignored) { }
    }

    function detonateExplosiveArrow(boss, loc) {
        // 需求：造成「无法破坏地形」的爆炸。
        // 这里不用 world.createExplosion：原版爆炸自带伤害/击退，会绕过我们的盾牌规则；
        // 因此只做爆炸的视听表现，伤害与击飞全部由脚本按半径结算。
        playSoundSafe(boss.world, loc, Sound.ENTITY_GENERIC_EXPLODE, 1.8, 1.0);
        spawnParticleSafe(boss.world, Particle.EXPLOSION_EMITTER, loc, 1, 0.0, 0.0, 0.0, 0.0);
        spawnParticleSafe(boss.world, Particle.EXPLOSION, loc, 6, 1.2, 0.7, 1.2, 0.0);
        spawnParticleSafe(boss.world, Particle.FLAME, loc, 40, 1.4, 0.8, 1.4, 0.08);
        spawnParticleSafe(boss.world, Particle.LARGE_SMOKE, loc, 18, 1.2, 0.7, 1.2, 0.04);

        var hits = 0;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                if (p.getLocation().distanceSquared(loc) > EXPLOSIVE_BLAST_RADIUS * EXPLOSIVE_BLAST_RADIUS) {
                    continue;
                }
                var status = resolveExplosiveHitPlayer(boss, p, loc);
                if (status === "hit") hits++;
            }
        } catch (e) {
            logError("Sharpshooter 爆裂箭爆炸结算异常", e);
        }
        return hits;
    }

    // 箭矢命中：实体命中或落地都从这里收口
    function resolveArrowImpact(boss, kind, hitPlayer, loc) {
        if (boss == null) return;
        if (kind === KIND_EXPLOSIVE) {
            detonateExplosiveArrow(boss, loc);
            return;
        }
        if (hitPlayer == null) return;                       // 命中方块：什么也不做
        if (!(hitPlayer instanceof PlayerClass)) return;      // 命中其他生物：不影响
        resolveArrowHitPlayer(boss, kind, hitPlayer);
    }

    // -----------------------------------------------------------------------
    // 攻击状态机
    // -----------------------------------------------------------------------
    // 需求：战斗中随机选择一种箭。这里额外做「不连续重复」处理：
    // 若上一招是某一种，就在其余三种里按权重抽取，因此不会出现连续两招相同。
    function pickAttackKind(boss) {
        var kinds = [KIND_VOLLEY, KIND_EXPLOSIVE, KIND_POISON, KIND_BINDING];
        var weights = [VOLLEY_WEIGHT, EXPLOSIVE_WEIGHT, POISON_WEIGHT, BINDING_WEIGHT];
        var total = 0.0;
        var i;
        for (i = 0; i < kinds.length; i++) {
            if (kinds[i] === boss.lastKind) continue;
            total += weights[i];
        }
        var roll = Math.random() * total;
        for (i = 0; i < kinds.length; i++) {
            if (kinds[i] === boss.lastKind) continue;
            if (roll < weights[i]) {
                boss.lastKind = kinds[i];
                return kinds[i];
            }
            roll -= weights[i];
        }
        // 兜底：理论上到不了这里（lastKind 至多排除一种）
        boss.lastKind = KIND_VOLLEY;
        return KIND_VOLLEY;
    }

    function windupTicksFor(kind) {
        if (kind === KIND_POISON) return POISON_AIM_TICKS;
        if (kind === KIND_BINDING) return BINDING_AIM_TICKS;
        if (kind === KIND_EXPLOSIVE) return EXPLOSIVE_WINDUP_TICKS;
        return VOLLEY_WINDUP_TICKS;
    }

    function startBowAttack(boss, target, forcedKind) {
        var kind = forcedKind == null ? pickAttackKind(boss) : forcedKind;
        var windup = windupTicksFor(kind);
        var shots = (kind === KIND_VOLLEY) ? VOLLEY_ARROWS : 1;
        var gap = (kind === KIND_VOLLEY) ? VOLLEY_SHOT_GAP_TICKS : 0;

        var act = {
            kind: kind,
            startTick: globalTick,
            windupEndTick: globalTick + windup,
            endTick: globalTick + windup + (shots - 1) * gap + RECOVER_TICKS,
            nextShotTick: globalTick + windup,
            shotsLeft: shots,
            shotIndex: 0,
            gap: gap,
            targetRef: target,
            targetUuid: (target != null) ? String(target.getUniqueId().toString()) : null,
            blockedCount: 0,
            hitCount: 0
        };
        boss.action = act;
        // 需求：攻击冷却 6 秒（从本次出招开始计算）
        boss.nextAttackTick = act.startTick + ATTACK_COOLDOWN_TICKS;

        var loc = boss.carrier.getLocation();
        if (kind === KIND_POISON || kind === KIND_BINDING) {
            playSoundSafe(boss.world, loc, Sound.ITEM_CROSSBOW_LOADING_MIDDLE, 1.2, 1.0);
        } else if (kind === KIND_EXPLOSIVE) {
            playSoundSafe(boss.world, loc, Sound.BLOCK_ANVIL_LAND, 0.8, 1.4);
        } else {
            playSoundSafe(boss.world, loc, Sound.ENTITY_ARROW_SHOOT, 1.1, 0.9);
        }
        return act;
    }

    function fireArrowFor(kind, boss, target) {
        var speed = VOLLEY_SPEED;
        if (kind === KIND_EXPLOSIVE) speed = EXPLOSIVE_SPEED;
        else if (kind === KIND_POISON) speed = POISON_SPEED;
        else if (kind === KIND_BINDING) speed = BINDING_SPEED;

        var dir = aimDirection(boss, target, speed);
        if (kind === KIND_VOLLEY) {
            // 三支之间做一点横向散角，看起来是一串而不是一支
            var spread = (Math.random() - 0.5) * VOLLEY_SPREAD * 2.0;
            var cos = Math.cos(spread);
            var sin = Math.sin(spread);
            var dx = dir.getX() * cos - dir.getZ() * sin;
            var dz = dir.getX() * sin + dir.getZ() * cos;
            dir = new Vector(dx, dir.getY(), dz).normalize();
        }
        return spawnBossArrow(boss, kind, dir, speed);
    }

    function updateAttackAction(boss, act) {
        var loc = boss.carrier.getLocation();
        var target = act.targetRef;
        var targetAlive = (target != null && isEngageablePlayer(target) && target.isOnline());

        // 目标没了：直接收招（冷却回退到很短，避免白白浪费一次 6 秒）
        if (!targetAlive) {
            boss.nextAttackTick = Math.min(boss.nextAttackTick, globalTick + 10);
            finishAction(boss, act);
            return;
        }

        // 瞄准 / 蓄力阶段：站定、持续面向目标、播放预警表现
        if (globalTick < act.windupEndTick) {
            faceTarget(boss, target.getLocation());
            spawnAimEffect(boss, act, target);
            return;
        }

        // 射击阶段：连射箭按 gap 逐支射出，其余一箭
        if (act.shotsLeft > 0 && globalTick >= act.nextShotTick) {
            var arrow = fireArrowFor(act.kind, boss, target);
            playSoundSafe(boss.world, loc, Sound.ENTITY_ARROW_SHOOT, 1.1, 1.0);
            if (arrow != null) act.shotIndex++;
            act.shotsLeft--;
            act.nextShotTick = globalTick + act.gap;
        }

        if (globalTick >= act.endTick) finishAction(boss, act);
    }

    function spawnAimEffect(boss, act, target) {
        var loc = boss.carrier.getLocation();
        var eye = boss.carrier.getEyeLocation();
        if (act.kind === KIND_POISON) {
            if (globalTick % 2 !== 0) return;
            // 绿色毒气蓄力
            spawnParticleSafe(boss.world, Particle.ITEM_SLIME,
                new Location(boss.world, eye.getX(), eye.getY(), eye.getZ()),
                5, 0.35, 0.35, 0.35, 0.0);
        } else if (act.kind === KIND_BINDING) {
            // 需求：紫色粒子 + 警示线警告被瞄准的玩家
            spawnParticleSafe(boss.world, Particle.WITCH,
                new Location(boss.world, eye.getX(), eye.getY(), eye.getZ()),
                4, 0.3, 0.3, 0.3, 0.0);
            drawWarningLine(boss, eye, target);
            var left = act.windupEndTick - globalTick;
            if (left % 20 === 0) {
                try {
                    playSoundSafe(boss.world, target.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 1.0, 1.6);
                    target.sendActionBar(ChatColor.DARK_PURPLE + "禁锢箭瞄准中 "
                        + ChatColor.GRAY + (left / 20) + "s" + ChatColor.YELLOW + "（举盾可挡）");
                } catch (ignored) { }
            }
        } else {
            if (globalTick % 2 !== 0) return;
            spawnParticleSafe(boss.world, Particle.CRIT,
                new Location(boss.world, eye.getX(), eye.getY(), eye.getZ()),
                3, 0.25, 0.25, 0.25, 0.0);
        }
    }

    function drawWarningLine(boss, from, target) {
        try {
            var to = target.getLocation().clone().add(0, AIM_HEIGHT, 0);
            for (var i = 1; i < BINDING_LINE_POINTS; i++) {
                var t = i / BINDING_LINE_POINTS;
                spawnParticleSafe(boss.world, Particle.DRAGON_BREATH, new Location(boss.world,
                    from.getX() + (to.getX() - from.getX()) * t,
                    from.getY() + (to.getY() - from.getY()) * t,
                    from.getZ() + (to.getZ() - from.getZ()) * t),
                    1, 0.0, 0.0, 0.0, 0.0);
            }
        } catch (ignored) { }
    }

    function finishAction(boss, act) {
        if (boss.action === act) boss.action = null;
        return null;
    }

    function updateAction(boss) {
        var act = boss.action;
        if (act == null) return;
        updateAttackAction(boss, act);
    }

    // -----------------------------------------------------------------------
    // 闪避：每 90 秒一次，抵挡任意伤害 + 瞬移远离玩家（白烟）
    // -----------------------------------------------------------------------
    function findDodgeLocation(boss, player) {
        try {
            var loc = boss.carrier.getLocation();
            var world = boss.world;
            var awayX = 0.0;
            var awayZ = 1.0;
            var refX = 0.0;
            var refZ = 0.0;
            var hasReference = false;
            if (player != null) {
                var pl = player.getLocation();
                refX = pl.getX();
                refZ = pl.getZ();
                awayX = loc.getX() - refX;
                awayZ = loc.getZ() - refZ;
                var len = Math.sqrt(awayX * awayX + awayZ * awayZ);
                if (len > 0.001) {
                    awayX /= len;
                    awayZ /= len;
                    hasReference = true;
                } else {
                    // 与参考玩家完全重叠：随机挑一个方向
                    var randomAngle = Math.random() * Math.PI * 2.0;
                    awayX = Math.cos(randomAngle);
                    awayZ = Math.sin(randomAngle);
                }
            }
            var currentGap = 0.0;
            if (hasReference) {
                currentGap = Math.sqrt(Math.pow(loc.getX() - refX, 2)
                    + Math.pow(loc.getZ() - refZ, 2));
            }

            // 两轮尝试：第一轮要求落点「比现在再远离参考玩家至少 DODGE_MIN_GAIN 格」，
            // 全部失败再放宽（保证被逼到墙角 / 悬崖边时也一定能闪走）。
            for (var pass = 0; pass < 2; pass++) {
                var requireFarther = (pass === 0 && hasReference);
                for (var i = 0; i < DODGE_ATTEMPTS; i++) {
                    // 以「正后方」为中心 ±DODGE_MAX_SPREAD 锥形内随机
                    var angle = (Math.random() - 0.5) * DODGE_MAX_SPREAD;
                    var cos = Math.cos(angle);
                    var sin = Math.sin(angle);
                    var dx = awayX * cos - awayZ * sin;
                    var dz = awayX * sin + awayZ * cos;
                    var distance = DODGE_MIN_DISTANCE
                        + Math.random() * (DODGE_MAX_DISTANCE - DODGE_MIN_DISTANCE);
                    var x = loc.getX() + dx * distance;
                    var z = loc.getZ() + dz * distance;
                    if (requireFarther) {
                        var newGap = Math.sqrt(Math.pow(x - refX, 2) + Math.pow(z - refZ, 2));
                        if (newGap < currentGap + DODGE_MIN_GAIN) continue;
                    }
                    var y = findStandY(world, x, z, loc.getY(), DODGE_SEARCH_UP, DODGE_SEARCH_DOWN);
                    if (y == null) continue;
                    return new Location(world, x, y, z, boss.faceYaw, boss.facePitch);
                }
            }
            return null;
        } catch (e) {
            logError("Sharpshooter 闪避落点解算异常", e);
            return null;
        }
    }

    function triggerDodge(boss, player) {
        // 需求：触发时才进入冷却
        boss.dodgeReady = false;
        boss.nextDodgeTick = globalTick + DODGE_COOLDOWN_TICKS;
        boss.dodgeCount++;

        // 参考玩家：优先取攻击者，其次取最近的玩家，最后退回当前目标
        //（多人 / 多个自定义 BOSS 同场时，「远离谁」必须按最近的威胁算）
        var reference = player;
        if (reference == null) reference = findNearestPlayer(boss);
        if (reference == null) reference = boss.target;

        var from = boss.carrier.getLocation().clone();
        var dest = findDodgeLocation(boss, reference);
        try {
            if (dest != null) {
                boss.carrier.teleport(dest);
            }
        } catch (e) {
            logError("Sharpshooter 闪避瞬移失败", e);
        }

        // 需求：表现效果为留下一团白色烟雾（起点 + 落点都给）
        spawnParticleSafe(boss.world, Particle.CLOUD, from, 30, 0.6, 0.9, 0.6, 0.03);
        spawnParticleSafe(boss.world, Particle.SMOKE, from, 20, 0.5, 0.8, 0.5, 0.02);
        playSoundSafe(boss.world, from, Sound.ENTITY_ENDERMAN_TELEPORT, 1.4, 1.2);
        if (dest != null) {
            spawnParticleSafe(boss.world, Particle.CLOUD, dest, 30, 0.6, 0.9, 0.6, 0.03);
            spawnParticleSafe(boss.world, Particle.SMOKE, dest, 20, 0.5, 0.8, 0.5, 0.02);
            playSoundSafe(boss.world, dest, Sound.ENTITY_ENDERMAN_TELEPORT, 1.2, 0.9);
        }
        log.info("Sharpshooter 触发闪避：第 " + boss.dodgeCount + " 次，"
            + (dest == null ? "未找到有效落点（原地抵挡）" : "落点 " + Math.round(dest.getX())
                + "," + Math.round(dest.getY()) + "," + Math.round(dest.getZ())));
        return dest != null;
    }

    function updateDodgeRecharge(boss) {
        if (boss.dodgeReady) return;
        if (globalTick < boss.nextDodgeTick) return;
        boss.dodgeReady = true;
        try {
            spawnParticleSafe(boss.world, Particle.END_ROD,
                new Location(boss.world, boss.carrier.getLocation().getX(),
                    boss.carrier.getLocation().getY() + 1.2,
                    boss.carrier.getLocation().getZ()),
                8, 0.4, 0.4, 0.4, 0.01);
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 箭矢推进（尾迹 / 寿命 / 兜底命中判定）
    // -----------------------------------------------------------------------
    function checkArrowPlayerHit(entry, arrowUuid, loc) {
        try {
            var boss = activeBosses[entry.bossUuid];
            if (boss == null) return false;
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                var pl = p.getLocation();
                var dx = pl.getX() - loc.getX();
                var dz = pl.getZ() - loc.getZ();
                if (dx * dx + dz * dz > ARROW_HIT_RADIUS * ARROW_HIT_RADIUS) continue;
                var dy = (pl.getY() + 1.0) - loc.getY();
                if (Math.abs(dy) > ARROW_HIT_VERTICAL) continue;
                // 命中：先登记再结算，避免同一支箭重复命中
                delete trackedArrows[arrowUuid];
                try { entry.proj.remove(); } catch (ignored) { }
                resolveArrowImpact(boss, entry.kind, p, loc);
                return true;
            }
            return false;
        } catch (e) {
            logError("Sharpshooter 箭矢兜底命中异常", e);
            return false;
        }
    }

    function updateTrackedArrows() {
        var uuids = Object.keys(trackedArrows);
        if (uuids.length === 0) return;
        for (var i = 0; i < uuids.length; i++) {
            var uuid = uuids[i];
            var entry = trackedArrows[uuid];
            if (entry == null) continue;
            try {
                var proj = entry.proj;
                if (proj == null || !proj.isValid() || proj.isDead()) {
                    delete trackedArrows[uuid];
                    continue;
                }
                entry.life--;
                if (entry.life <= 0) {
                    try { proj.remove(); } catch (ignored) { }
                    delete trackedArrows[uuid];
                    continue;
                }
                var loc = proj.getLocation();
                orientArrow(proj);       // 跟着真实弹道（含重力下坠）持续修正朝向
                spawnArrowTrail(entry, loc);
                // 生成后前 2 tick 不判定，避免生成瞬间误判
                if (entry.life <= ARROW_LIFE_TICKS - 2) {
                    if (checkArrowPlayerHit(entry, uuid, loc)) continue;
                }
            } catch (e) {
                delete trackedArrows[uuid];
            }
        }
    }

    // -----------------------------------------------------------------------
    // 战斗总控
    // -----------------------------------------------------------------------
    function updateCombat(boss) {
        var target = findNearestPlayer(boss);
        boss.target = target;

        if (boss.action != null) {
            updateAction(boss);
            return;
        }
        if (target == null) return;

        var loc = boss.carrier.getLocation();
        var tgt = target.getLocation();
        var dx = tgt.getX() - loc.getX();
        var dz = tgt.getZ() - loc.getZ();
        var dist = Math.sqrt(dx * dx + dz * dz);

        // 开火条件：冷却好了、在射程内、拉开了一点距离、且视线没被挡住
        if (globalTick >= boss.nextAttackTick
            && dist <= ATTACK_MAX_RANGE && dist >= ATTACK_MIN_RANGE
            && hasLineOfSight(boss, tgt)) {
            startBowAttack(boss, target, null);
            return;
        }
        updateMovement(boss, target);
    }

    function updateBossBar(boss) {
        if (boss.bar == null) return;
        boss.barTick++;
        if (boss.barTick % 5 === 0) {
            try {
                var health = boss.carrier.getHealth();
                boss.bar.setTitle(BOSS_NAME + "  " + ChatColor.YELLOW + Math.max(0, Math.round(health))
                    + ChatColor.GRAY + "/" + ChatColor.YELLOW + Math.round(MAX_HEALTH)
                    + (boss.dodgeReady ? ChatColor.AQUA + "  [闪避就绪]" : ChatColor.DARK_GRAY + "  [闪避 "
                        + Math.max(0, Math.ceil((boss.nextDodgeTick - globalTick) / 20.0)) + "s]"));
                boss.bar.setProgress(clamp(health / MAX_HEALTH, 0.0, 1.0));
            } catch (ignored) { }
        }
        if (boss.barTick % 20 !== 0) return;
        try {
            var loc = boss.carrier.getLocation();
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (p.getLocation().distanceSquared(loc) <= BAR_VIEW_RANGE * BAR_VIEW_RANGE) {
                    boss.bar.addPlayer(p);
                } else {
                    boss.bar.removePlayer(p);
                }
            }
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 死亡序列
    // -----------------------------------------------------------------------
    function startDeathSequence(boss) {
        if (boss.dead) return;
        boss.dead = true;
        boss.action = null;
        boss.deathStartTick = globalTick;
        boss.deathEndTick = globalTick + DEATH_SEQUENCE_TICKS;
        try {
            boss.deathLocation = boss.carrier.getLocation().clone();
        } catch (e) {
            boss.deathLocation = null;
        }
        removeBossArrows(boss.uuid);
        removeBossBar(boss);
        if (boss.deathLocation != null) {
            playSoundSafe(boss.world, boss.deathLocation, Sound.ENTITY_SKELETON_DEATH, 1.6, 0.8);
            spawnParticleSafe(boss.world, Particle.CLOUD, boss.deathLocation, 30, 0.8, 1.0, 0.8, 0.04);
            spawnParticleSafe(boss.world, Particle.CRIT, boss.deathLocation, 25, 0.8, 1.0, 0.8, 0.1);
        }
        log.info("Sharpshooter 进入死亡序列：" + boss.uuid);
    }

    function updateDeathSequence(boss) {
        if (boss.deathLocation != null && globalTick % 4 === 0) {
            spawnParticleSafe(boss.world, Particle.SMOKE, boss.deathLocation, 8, 0.6, 0.8, 0.6, 0.02);
        }
        if (globalTick >= boss.deathEndTick) {
            log.info("Sharpshooter 死亡序列完成。");
            cleanupBoss(boss);
        }
    }

    function updateBoss(boss) {
        if (boss.dead) {
            updateDeathSequence(boss);
            return;
        }
        if (boss.carrier == null || !boss.carrier.isValid()) {
            cleanupBoss(boss);
            return;
        }
        // 流浪者是亡灵：白天会被点燃。逐 tick 清火焰 + 关闭视觉火焰，
        // 配合「火焰伤害免疫」保证它既不着火也不掉血。
        try { boss.carrier.setFireTicks(0); } catch (ignored) { }
        try { boss.carrier.setVisualFire(false); } catch (ignored) { }
        updateDodgeRecharge(boss);
        updateBossBar(boss);
        updateCombat(boss);
        // 出招期间不掉队：动作结束后把位置贴回地面
        if (boss.action == null && globalTick % 20 === 0) snapToGround(boss);
    }

    function updateAllBosses() {
        var uuids = Object.keys(activeBosses);
        for (var i = 0; i < uuids.length; i++) {
            var boss = activeBosses[uuids[i]];
            if (boss == null) continue;
            try {
                updateBoss(boss);
            } catch (e) {
                logError("Sharpshooter BOSS[" + uuids[i] + "] tick 异常", e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 事件注册
    // M-2：OpenJS 并行加载脚本，监听器表是普通 HashMap，顶层 registerEvent 会抛
    // ConcurrentModificationException，统一推迟到主线程第一个 tick 串行注册。
    // -----------------------------------------------------------------------
    function registerAllEvents() {

        // 伤害免疫 + 闪避：只接受玩家来源的伤害；闪避就绪时抵挡任意伤害来源
        registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null) return;

                if (boss.dead) {
                    event.setCancelled(true);
                    return;
                }
                if (isIgnoredDamageCause(event.getCause())) {
                    event.setCancelled(true);
                    return;
                }

                var source = null;
                try { source = event.getDamageSource(); } catch (ignored) { }
                var attacker = null;
                if (source != null) {
                    attacker = source.getCausingEntity();
                    if (attacker == null) attacker = source.getDirectEntity();
                }
                if (attacker != null && !(attacker instanceof PlayerClass)) {
                    event.setCancelled(true);
                    return;
                }

                // 需求：每 90 秒拥有一次抵挡任意伤害来源的能力，并瞬移远离玩家
                if (boss.dodgeReady) {
                    event.setCancelled(true);
                    var player = (attacker instanceof PlayerClass) ? attacker : boss.target;
                    triggerDodge(boss, player);
                }
            } catch (e) {
                logError("Sharpshooter 受伤事件异常", e);
            }
        });

        // 近战 / 远程命中：只做骨骼碰撞反馈
        registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null || boss.dead) return;

                // 子类事件监听器会收到基类伤害事件，普通伤害没有 getDamager()，必须 try/catch
                var damager = null;
                try { damager = event.getDamager(); } catch (e) { return; }
                if (damager == null) return;
                if (damager instanceof PlayerClass) {
                    var loc = boss.carrier.getLocation();
                    playSoundSafe(boss.world, loc, Sound.ENTITY_SKELETON_HURT, 0.7, 1.3);
                    spawnParticleSafe(boss.world, Particle.CRIT,
                        new Location(boss.world, loc.getX(), loc.getY() + 1.2, loc.getZ()),
                        6, 0.4, 0.4, 0.4, 0.05);
                }
            } catch (e) {
                logError("Sharpshooter 近战/远程事件异常", e);
            }
        });

        // 箭矢命中：取消原版行为（伤害已归零），改由脚本结算
        registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function (event) {
            try {
                var proj = event.getEntity();
                if (proj == null) return;
                var uuid = String(proj.getUniqueId().toString());
                var entry = trackedArrows[uuid];
                if (entry == null) return;

                event.setCancelled(true);
                delete trackedArrows[uuid];

                var boss = activeBosses[entry.bossUuid];
                var hitPlayer = null;
                try { hitPlayer = event.getHitEntity(); } catch (ignored) { }
                var loc = proj.getLocation().clone();
                try {
                    var hitBlock = event.getHitBlock();
                    if (hitBlock != null) loc = hitBlock.getLocation().add(0.5, 0.5, 0.5);
                } catch (ignored) { }
                try { proj.remove(); } catch (ignored) { }

                if (boss != null && !boss.dead) {
                    resolveArrowImpact(boss, entry.kind, hitPlayer, loc);
                }
            } catch (e) {
                logError("Sharpshooter 箭矢命中事件异常", e);
            }
        });

        // 死亡：清空掉落并进入死亡序列
        registerEvent("org.bukkit.event.entity.EntityDeathEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null) return;
                try {
                    event.getDrops().clear();
                    event.setDroppedExp(0);
                } catch (ignored) { }
                startDeathSequence(boss);
            } catch (e) {
                logError("Sharpshooter 死亡事件异常", e);
            }
        });

    }   // ---- end registerAllEvents ----

    // -----------------------------------------------------------------------
    // 主循环
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            processSyncDelayedTasks();
        } catch (e) {
            logError("Sharpshooter 延迟队列异常", e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            logError("Sharpshooter 主循环异常", e);
        }
        try {
            updateTrackedArrows();
        } catch (e) {
            logError("Sharpshooter 箭矢推进异常", e);
        }
    });

    scheduleSync(1, registerAllEvents);
    scheduleSync(2, cleanupOrphans);
    task.repeat(ticks(600), ticks(600), cleanupOrphans);

    // -----------------------------------------------------------------------
    // BossRegistry 注册
    // M-1：跨脚本引擎保存 JS 对象会读串号，只传基本值与函数；
    // 别名 / 简介用 java.util.ArrayList（纯 Java 容器），跨引擎读取最稳。
    // -----------------------------------------------------------------------
    var registeredThisInstance = false;

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (api == null) return;
            if (!registeredThisInstance || api.heartbeat(BOSS_ID) !== true) {
                // 必须覆盖注册：CallBoss / 本脚本重载后旧注册表可能已失效，
                // heartbeat 返回 false 时必须重新注册当前实例的 spawn 句柄。
                var aliases = new ArrayList();
                for (var i = 0; i < BOSS_ALIASES.length; i++) aliases.add(String(BOSS_ALIASES[i]));
                var lore = new ArrayList();
                for (var j = 0; j < BOSS_LORE.length; j++) lore.add(String(BOSS_LORE[j]));
                api.register(BOSS_ID, BOSS_NAME, aliases, lore, spawnSharpshooter);
                registeredThisInstance = true;
            }
        } catch (e) {
            logError("Sharpshooter 注册异常", e);
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // 启动日志（契约第 10 节：必须能看到脚本自己的加载日志）
    // -----------------------------------------------------------------------
    log.info("Sharpshooter 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤绿宝石。");
})();
