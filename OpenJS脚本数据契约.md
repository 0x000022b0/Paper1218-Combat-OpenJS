# OpenJS 脚本数据契约

> **适用范围**：`E:\McServer\1218_server_combat\plugins\OpenJS\scripts\` 下的所有 OpenJS 脚本
> **运行时**：OpenJS 1.5.0 / Paper 1.21.8 / Java 21
> **契约版本**：1.6.0
> **最后更新**：2026-10-02
> **优先级**：本契约与《可能有用的开发资料.md》冲突时，以本契约为准；与 OpenJS / Bukkit 实际 API 冲突时，以实测结果为准，并把实测结论回写到本契约。

---

## 0. 术语与约束级别

- **MUST**：必须遵守。违反视为不合格交付，不得上线。
- **SHOULD**：建议遵守。偏离时必须在脚本头注释或更新记录中说明原因。
- **MAY**：可选。
- **脚本**：单个 `.js` 文件。
- **全局作用域**：OpenJS 脚本引擎的顶层作用域。不同脚本在此互相覆盖同名 `var` / `function`。
- **BOSS 脚本**：通过 `getShared("BossRegistry").register(...)` 注册、由 `/call boss` 召唤的脚本。
- **主线程**：Bukkit `runTaskTimer` / `runTask` 所在的服务器线程。只有该线程可以安全修改世界与实体。

---

## 1. 文件与命名契约

| 项目 | 规则 | 示例 |
| --- | --- | --- |
| 文件名 | 英文大驼峰 + `.js` | `InfernoFoehn.js`、`FrostWarden.js` |
| BOSS id | 英文小写 + 下划线，全局唯一 | `inferno_foehn`、`frost_warden` |
| 显示名 | 中文，用于烈焰棒、BossBar、提示 | `炎狱焚风` |
| 脚本内常量 | `UPPER_SNAKE_CASE` | `AURA_RANGE`、`SMALL_FIREBALL_YIELD` |
| 运行时状态字段 | `lowerCamelCase` | `staggerTicks`、`rangedHitCount` |
| 函数名 | `lowerCamelCase`，动词开头 | `spawnBoss`、`updateAura`、`detonate` |
| Tag / PDC key | 必须带 BOSS id 前缀，避免跨 BOSS 冲突 | `inferno_foehn_boss`、`inferno_foehn_projectile` |
| 注释语言 | 中文注释 + 英文标识符，禁止拼音变量 | `// 远程硬直计数` |
| 编码 | UTF-8 无 BOM | — |
| 缩进 | 4 个空格，不使用 Tab | — |
| 语句结尾 | 必须写分号 | — |
| 字符串 | 统一双引号；玩家可见文本可包含中文 | `log.error("..." + e);` |
| 行宽 | SHOULD ≤ 120 字符；长参数可换行对齐 | — |

---

## 2. 强制脚本骨架（IIFE + strict）

**MUST**：所有脚本顶层不得存在裸 `var` / `function` / 常量；整个可执行内容必须包在 IIFE 内。

```js
/*
 * XxxBoss.js —— 自定义 BOSS「显示名」（OpenJS 1.5.0）
 *
 * 获取方式：/call boss 显示名
 * 召唤方式：烈焰棒右键地面 → 6 秒倒计时 → spawn
 *
 * 机制摘要：
 *   - ...
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // 1. Java / Bukkit 类型
    // 2. 数值常量
    // 3. 运行时状态
    // 4. 工具函数
    // 5. 生命周期（spawn / cleanup）
    // 6. AI / 技能
    // 7. 事件注册
    // 8. 主循环
    // 9. BossRegistry 注册

})();
```

规则：

1. IIFE 必须是文件中最外层的可执行结构；头注释可以放在 IIFE 外。
2. `"use strict";` 必须是 IIFE 的第一条语句。
3. 文件最后一行必须是 `})();`。
4. OpenJS 提供的全局对象（`plugin`、`log`、`task`、`registerEvent`、`addCommand`、`getShared`、`setShared`、`ticks`、`toJavaList`、`toArray` 等）在 IIFE 内可直接访问，**不得**重新赋值。
5. 不同脚本之间只允许通过 `getShared` / `setShared` 通信；共享对象必须有版本号（如 `BossRegistry.version = 1`）。
6. 严禁在顶层执行 `Bukkit.getWorlds()`、`world.spawn`、`world.getBlockAt` 等世界访问；顶层可能运行在异步加载线程。

---

## 3. 内部结构与顺序契约

脚本内部 SHOULD 按以下顺序组织，并用 `// ----` 分隔条标出区块：

| 顺序 | 区块 | 内容 |
| --- | --- | --- |
| 1 | Java / API 导入 | `Java.type` / `Class.forName`；集中放在最前面 |
| 2 | 数值配置 | 所有可调常量，`UPPER_SNAKE_CASE` |
| 3 | 运行时状态 | `activeBosses`、`trackedProjectiles`、`syncDelayedTasks`、`globalTick` 等 |
| 4 | 工具函数 | `clamp`、`scheduleSync`、`groundSurfaceY`、`findNearestPlayer` 等 |
| 5 | 生命周期 | `spawnXxx`、`cleanupBoss`、`cleanupOrphans` |
| 6 | 外观 / 移动 | `syncDisplay`、`spawnBossParticles`、`updateMovement` |
| 7 | 战斗 / 技能 | `updateAura`、`fireXxx`、`startCharge`、`updatePhaseTransition`、`startAttract` |
| 8 | 事件注册 | `registerEvent(...)`，放在对应函数之后，便于阅读 |
| 9 | 主循环 | `task.repeat(ticks(1), ticks(1), ...)` |
| 10 | BossRegistry 注册 | `bossDefinition`、`ensureRegistered()`、20 tick 心跳 |
| 11 | 启动日志 | `log.info("<脚本名> 已加载：...")` |

---

## 4. OpenJS 1.5.0 兼容性硬约束

以下全部为 **MUST**，均来自本服实测：

1. **`task.delay()` 是异步线程池**，不能在回调里访问 Bukkit 世界/实体。
   替代方案：
   - 周期性逻辑：`task.repeat(ticks(1), ticks(1), ...)`（主线程）；
   - 延迟逻辑：维护 `syncDelayedTasks` 队列，在主循环中执行。
2. **子类事件会收到基类事件**。`EntityDamageByEntityEvent` 与 `EntityDamageEvent` 共用 HandlerList，普通伤害事件没有 `getDamager()`。
   必须用 `try/catch` 获取子类方法，示例见第 10 节。
3. **`world.spawn(location, SomeClass)` 必须传真正的 `java.lang.Class`**：
   ```js
   var Class = Java.type("java.lang.Class");
   var HuskClass = Class.forName("org.bukkit.entity.Husk");
   var carrier = world.spawn(location, HuskClass);
   ```
4. **脚本顶层是异步执行的**：`cleanupOrphans()`、扫描世界、删除实体等必须放到主循环或 `scheduleSync(1, ...)` 中。
5. **函数定义缺失只会在调用时报 `ReferenceError`**：新增函数后必须 `/oj reload` 并观察日志中的 `tick 异常`。
6. **Nashorn 重载歧义**：`world.createExplosion(location, power, false, breakBlocks)` 在 Java 21 + OpenJS 1.5.0 下会报 `NoSuchMethodException: Can't unambiguously select ...`。
   必须使用 5 参数形式补 `null` Entity：
   ```js
   world.createExplosion(location, power, false, breakBlocks, null);
   ```
7. **不要依赖 `setYield()` / 原版 NBT 爆炸威力**：
   - `SmallFireball.setYield()` 在 Paper 1.21.8 不产生爆炸；
   - `Fireball` 的原版威力是整数 NBT 字段，无法表达 1.75 / 2.75 / 4.5 / 6.5；
   - 必须用 `World.createExplosion(Location, float, ...)` 自行引爆。
8. **末影龙龙息弹命中不会走普通爆炸**，而是生成 `AreaEffectCloud`；需要拦截 `EnderDragonFireballHitEvent` 并 `setCancelled(true)`。
9. **自动重载不可靠**：修改脚本后必须手动 `/oj reload <脚本名>`，并确认日志出现 `Loaded the script ...` 与脚本自己的加载日志。
10. **彩色微粒必须使用 `Particle.DUST` + `Particle.DustOptions`**：
    ```js
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var RedDust = new DustOptions(Color.fromRGB(255, 40, 40), 1.5);
    world.spawnParticle(Particle.DUST, x, y, z, 1, 0, 0, 0, 0, RedDust);
    ```
    不要使用 `Particle.REDSTONE`（1.21.8 不存在该名称）。
11. **BlockDisplay 自转必须补偿平移量**：方块模型原点在方块角上，直接旋转会公转；`setDisplayTransform(display, scale, spin)` 需要按“方块中心旋转前后位置差”反算 translation，并加轻微上下浮动模拟原版末影水晶。
12. **BOSS 无敌阶段契约**：HP 归零进入火种/动画阶段时，`EntityDamageEvent`、`EntityDamageByEntityEvent`、`updateBoss` 都必须识别 `fireSeedPhase` / `fireSeedAnimation`；火种数量必须使用独立字段（如 `boss.fireSeedCount`）保存，不得用固定 4 常量代替运行时状态。
13. **实体 Class 参数必须用 `Class.forName`**：`Java.type("org.bukkit.entity.ItemDisplay")` 是 Nashorn `StaticClass`，传给 `world.spawn(location, XxxClass)` 会抛 `ClassCastException`；必须写 `Class.forName("org.bukkit.entity.ItemDisplay")`。若该异常被 `spawn` 内部 catch 后返回 false，会产生“附近空间不足”的误报。
14. **禁止 `player.damage(amount, null)`**：Nashorn 无法在 `(double, Entity)` 与 `(double, DamageSource)` 之间选择；必须传真实实体（投射物/载具）或改用单参数 `player.damage(amount)`。

---

## 5. 调度与生命周期契约

### 5.1 主循环

每个独立 BOSS/系统脚本 SHOULD 只有一个 1 tick 主循环：

```js
var globalTick = 0;
var syncDelayedTasks = [];

function scheduleSync(delayTicks, callback) {
    syncDelayedTasks.push({ at: globalTick + Math.max(0, delayTicks), fn: callback });
}

function processSyncDelayedTasks() {
    var current = syncDelayedTasks;
    syncDelayedTasks = [];
    for (var i = 0; i < current.length; i++) {
        if (globalTick >= current[i].at) {
            try { current[i].fn(); } catch (e) {
                log.error("延迟任务异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
        } else {
            syncDelayedTasks.push(current[i]);
        }
    }
}

task.repeat(ticks(1), ticks(1), function () {
    globalTick++;
    processSyncDelayedTasks();
    updateAllBosses();
    updateTrackedProjectiles();
});
```

### 5.2 生命周期规则

1. `spawn(location, player)` 必须返回 `true/false`，失败时清理已生成的实体和 BossBar。
2. BOSS 死亡、移除、脚本卸载时必须能通过 Tag/PDC 找到并清理：载具、显示实体、BossBar、投射物、特殊弹体。
3. `cleanupOrphans()` 必须在 `scheduleSync(1, ...)` 或主循环中执行，不能在顶层直接执行。
4. 心跳 MUST 每 20 tick 刷新一次，否则 `BossRegistry` 会在约 10 秒后判定脚本失效。

---

## 6. 数据 Schema 契约

### 6.1 BOSS 状态对象（`boss`）

在 `spawnXxx` 中创建，存入 `activeBosses[uuid]`。推荐字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | BOSS id |
| `uuid` | string | ✅ | 载具 UUID（字符串） |
| `carrier` | Entity | ✅ | 主载具（Husk/Zombie）：寻路、移动、主生命值 |
| `slimeCarrier` | Slime / null | SHOULD | 副碰撞箱（size 4，隐形、全程浮空），命中后伤害转入 `carrier` |
| `display` | BlockDisplay | ✅ | 外观显示实体 |
| `world` | World | ✅ | BOSS 所在世界 |
| `bar` | BossBar | ✅ | 血条 |
| `barKey` | NamespacedKey | ✅ | 用于重载清理 |
| `objective` | Objective / null | SHOULD | 计分板目标 `inferno_foehn_hp`，记录共享生命值 |
| `scoreKey` | string / null | SHOULD | 该 BOSS 在 objective 中的条目（`if_<uuid 前 12 位>`） |
| `team` | Team / null | SHOULD | 包含 Husk 与 Slime 的队伍（`ijf_<uuid 前 12 位>`）；`prefix` 必须为空字符串，避免原版命令反馈 / 死亡消息把队伍前缀与实体自定义名叠加成“[炎狱焚风] 炎狱焚风” |
| `lastDamageTick` | number | SHOULD | 上次伤害结算的全局 tick，用于同一 tick 双命中去重 |
| `lastDamageSource` | string / null | SHOULD | 上次伤害来源 UUID，同一 tick 同一攻击者只结算一次 |
| `spin` | number | ✅ | 外观自转角度 |
| `nextLargeFireballTick` | number | ✅ | 大型火球冷却 |
| `nextVolleyTick` | number | ✅ | 小型弹幕冷却 |
| `nextChargeTick` | number | ✅ | 冲撞冷却 |
| `volleyLeft` | number | ✅ | 剩余小火球数量；0 表示无弹幕 |
| `volleyNextTick` | number | ✅ | 弹幕下一发射击 tick |
| `charge` | object / null | ✅ | 当前冲撞数据，见 6.3 |
| `rangedHitCount` | number | ✅ | 远程命中累计 |
| `staggerTicks` | number | ✅ | 硬直剩余 tick |
| `attract` | object / null | ✅ | 当前吸附激光，见 6.4 |
| `nextAttractTick` | number | ✅ | 吸附激光下一次可用 tick |
| `largeFireballWarning` | object / null | ✅ | 大型火焰弹 12 tick 红色预警，见 6.8 |
| `fireSeedCount` | number | ✅ | **独立火种数量变量**：清一个 -1；决定下次召唤数量与回血量 |
| `fireSeedPhase` | boolean | ✅ | 是否处于 20 秒火种阶段（无敌 / 煤炭块 / 停转） |
| `fireSeedPhaseStartTick` | number | ✅ | 火种阶段开始 tick |
| `fireSeedPhaseEndTick` | number | ✅ | 火种阶段结束 tick（开始 + 400） |
| `fireSeedAnimation` | boolean | ✅ | 是否处于 5 秒火焰漩涡回归动画 |
| `fireSeedAnimationStartTick` | number | ✅ | 回归动画开始 tick |
| `fireSeedAnimationEndTick` | number | ✅ | 回归动画结束 tick（开始 + 100） |
| `phase2Triggered` | boolean | ✅ | 是否已进入半血阶段；HP 归零时自动置 true |
| `dragonTexture` | boolean | ✅ | 半血后视觉/数值开关 |
| `pendingPhase` | boolean | ✅ | 是否已排队阶段转换 |
| `transitioning` | boolean | ✅ | 是否处于 5 秒无敌转换 |
| `transitionStartTick` | number | ✅ | 转换开始 tick |
| `transitionEndTick` | number | ✅ | 转换结束 tick |
| `dead` | boolean | ✅ | 是否进入死亡序列 |
| `deathStartTick` | number | ✅ | 死亡序列开始 tick |
| `deathEndTick` | number | ✅ | 死亡序列结束 tick |
| `deathLocation` | Location / null | ✅ | 死亡前摇中心 |
| `target` | Player / null | SHOULD | 每 tick 缓存的最近玩家 |

> 约定：字段只增不删；删除字段必须提升契约版本并写明迁移方式。

### 6.2 `trackedProjectiles` 条目

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `proj` | Entity | ✅ | 火球 / 龙息弹 / 末影水晶实体 |
| `kind` | `"fireball"` \| `"crystal"` | ✅ | 投射物类型 |
| `power` | number(float) | ✅ | 自定义爆炸威力 |
| `trail` | `"flame"` \| `"dragon"` \| `"none"` | ✅ | 尾迹粒子类型 |
| `life` | number | ✅ | 剩余寿命 tick；≤0 时清理/引爆 |
| `breakBlocks` | boolean | ✅ | 爆炸是否破坏方块 |
| `detonated` | boolean | MAY | 火球已命中并手动引爆；防止重复爆炸 |
| `dir` | Vector | 水晶必填 | 水晶火球方向 |
| `speed` | number | 水晶必填 | 水晶火球每 tick 位移 |

生命周期：`spawnTrackedFireball` 登记 → `ProjectileHitEvent` 命中 → `detonateTrackedFireball` 调用 float 爆炸 → 删除或下一 tick 清理。水晶火球由 `updateSpecialFireball` 手动步进。

### 6.3 `charge` 条目

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `phase` | `"telegraph"` \| `"dash"` | 前摇 / 冲刺 |
| `ticksLeft` | number | 前摇剩余 tick |
| `dir` | Vector | 水平方向 |
| `travelled` | number | 已移动距离 |
| `damageEnabled` | boolean | 当前设计固定 true（每次都是强化冲撞） |
| `damage` | number | 命中伤害 |
| `step` | number | 每 tick 位移，用于区分普通/超级冲撞 |
| `maxDistance` | number | 最大距离 |
| `hitRadius` | number | 命中半径 |
| `superCharge` | boolean | 是否超级强化冲撞 |
| `specialFireballFired` | boolean | 是否已发射水晶火球 |
| `fireCount` | number | 沿途点燃方块计数 |
| `hitPlayers` | object | `uuid -> true`，防止同一玩家重复受伤 |
| `targetUuid` | string / null | 目标玩家，用于发射水晶火球 |

### 6.4 `attract` 吸附激光条目

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `target` | Player | 被吸附玩家 |
| `targetName` | string | 玩家名，用于提示 |
| `endTick` | number | 结束 tick（开始 + 600） |
| `nextReminderTick` | number | 下一次提醒 tick |

### 6.5 `syncDelayedTasks` 条目

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `at` | number | 执行时的 `globalTick` |
| `fn` | function | 主线程回调 |

### 6.6 `CallBoss` pending 召唤条目

> 新版 CallBoss 的 `pendingSummons` 是 `playerUuid -> pending` 的字典，`pendingOrder` 维护插入顺序。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `player` | Player | 召唤者 |
| `playerUuid` | string | 防止同一玩家重复排队 |
| `bossId` | string | BOSS id，倒计时结束时重新解析定义 |
| `bossName` | string | 显示名 |
| `silent` | boolean | 旧版 silentSummon 兼容：不播报召唤/倒计时/成功消息 |
| `location` | Location | 右键时确定的生成位置 |
| `worldName` | string | 倒计时结束时校验世界 |
| `readyTick` | number | `globalTick + 120` |
| `nextAnnounceTick` | number | 下一次倒计时播报 tick |

### 6.7 `BossRegistry` 注册定义与 API

**注册形式：**

- 对象形式（旧脚本继续兼容）：`api.register(def)`
- 位置参数形式（新脚本推荐）：`api.register(id, name, aliases, lore, spawnFn)`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 英文唯一 id |
| `name` | string | ✅ | 中文显示名 |
| `aliases` | string[] / java.util.List | MAY | 指令别名 |
| `lore` | string[] / java.util.List | MAY | 召唤物 lore 的额外行 |
| `spawn` | function | ✅ | `function(location, player) { return true/false; }` |
| `heartbeat` | number | MAY | 旧字段；新版框架不读取，脚本必须每 20 tick 调 `api.heartbeat(id)` |
| `stickName` | string | MAY | 旧版兼容：自定义召唤物显示名 |
| `stickLore` | string[] | MAY | 旧版兼容：提供时完全替换默认 lore（空数组 = 无 lore） |
| `consumeOnSummon` | boolean | MAY | 旧版兼容：召唤成功后消耗一个对应召唤物 |
| `silentSummon` | boolean | MAY | 旧版兼容：不播报召唤/倒计时/成功消息 |

**共享 API：**

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `register(def)` / `register(id,name,aliases,lore,spawnFn)` | boolean | 覆盖注册；跨引擎数据立即快照为 Java 值 |
| `unregister(idOrDef)` | boolean | 注销并清理所有字段 |
| `heartbeat(id)` | boolean | 注册表里存在该 id 时刷新心跳并返回 true |
| `has(id)` | boolean | 已注册且心跳未超时 |
| `get(id)` | java.util.Map / null | 兼容旧调用：`{id,name,alive}`；只建议做真值判断 |
| `getName(id)` | string | 显示名 |
| `getAliases(id)` | java.util.List | 别名 |
| `describe(id)` | java.util.List | 可读注册信息 |
| `resolve(query)` | string / null | 按 id / 显示名 / 别名 / 唯一前缀解析，返回 id；歧义或未找到返回 null |
| `list()` | string[] | 存活 BOSS id 数组 |
| `createStick(id)` | ItemStack / null | 创建召唤绿宝石 |
| `spawn(id, location, player)` | boolean | 直接调用注册的 spawn 句柄 |

**召唤物约定：**

- 新材料 `EMERALD`，显示名默认等于 BOSS 显示名；旧 `BLAZE_ROD` / `STICK` / `ECHO_SHARD` 仍可识别。
- 新 PDC key `callboss_summon_boss_id`，同时写旧 key `call_boss_rod_boss_id`。
- `consumeOnSummon: true` 时，召唤成功后从玩家主手 / 副手 / 背包消耗 1 个对应召唤物。
- 心跳超时 10 秒；`api.heartbeat(id)` 返回 false 说明注册表已更换或自身条目丢失，必须重新注册当前实例的 spawn 句柄。

### 6.8 `largeFireballWarning` 条目

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `targetUuid` | string | 预警目标玩家 UUID |
| `endTick` | number | 预警结束 tick（开始 + 12） |
| `lastDirection` | Vector | 目标失效/丢失时的最后发射方向 |

### 6.9 `activeFireSeeds` 条目

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `uuid` | string | 火种载具 UUID |
| `carrier` | Entity | 不可见 Husk 火种载体（20 HP） |
| `display` | BlockDisplay | 岩浆块贴图显示实体 |
| `bossUuid` | string | 所属 BOSS UUID |
| `index` | number | 东南西北方向索引（0=东、1=西、2=南、3=北） |
| `spawnTick` | number | 火种生成 tick |

### 6.10 `DouQuQu` 共享 API

`DouQuQu.js` 通过 `setShared("DouQuQu", api)` 提供无差别攻击模式状态；BOSS 脚本必须通过该 API 判断/登记，不得各自维护私有开关。

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `isActive(bossId)` | string | boolean | 指定 BOSS 是否开启（`all` 时对任意 id 返回 true） |
| `markEntity(bossId, entityOrUuid)` | string, Entity/string | void | BOSS 每 tick 登记载具/碰撞箱 UUID，供攻击者判定 |
| `unmarkEntity(entityOrUuid)` | Entity/string | void | 清理时注销 |
| `isActiveEntity(entityOrUuid)` | Entity/string | boolean | 判断实体是否属于开启模式的 BOSS |
| `enableBoss(id)` / `disableBoss(id)` | string | void | 单 BOSS 开关 |
| `enableAll()` / `disableAll()` | - | void | 全局开关；`disableAll` 必须同时清空单 BOSS 状态 |
| `listActive()` | - | string[] | 当前开启列表 |

持久化：状态写入主世界 PDC key `douququ_state`，脚本/服务器重启后恢复。

BOSS 脚本接入契约：

1. 目标选择函数必须在 `isActive(boss.id)` 时返回最近 `LivingEntity`（排除自身载具、自己的幻影/火种/展示实体、ArmorStand），否则回退到最近玩家；
2. 范围伤害/弹幕命中扫描必须使用统一目标列表：普通模式 = `world.getPlayers()`，无差别模式 = `world.getLivingEntities()` 过滤后；
3. `EntityDamageEvent` 中“只允许玩家来源”的判断必须按两种情况放行：
   - 攻击者是开启模式的脚本 BOSS：`isActiveEntity(attacker)`（投射物检查 `getShooter()`）；
   - 目标 BOSS 自身开启模式：任何实体攻击者（普通生物/脚本 BOSS/投射物）都放行，否则普通生物打不掉开启模式 BOSS 的血；
4. 每 tick 调用 `markEntity`，死亡/清理调用 `unmarkEntity`；
5. 未接入上述规则的 BOSS 不会响应 `/douququ`。

---


### 6.11 `EquipRegistry` 注册定义（自定义装备）

`GetEquip.js` 通过 `setShared("EquipRegistry", api)` 提供通用装备获取 API；装备脚本通过
`getShared("EquipRegistry").register(def)` 注册。指令格式统一为 `/equip <槽位> [装备名]`，
当前武器槽位为 `arms`，例如 `/equip arms 村好剑`；盾牌使用 `offhand` 槽位，
`/equip shield 基础盾牌` 是 `/equip offhand 基础盾牌` 的别名写法。
GetEquip 目前内置槽位别名：`weapon` / `weapons` → `arms`，`shield` / `off_hand` / `secondary` → `offhand`。

> **⚠️ 重点：自定义装备 / 技能选择触发事件前，MUST 先阅读 8.7 玩家事件可用性清单。**

装备定义字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 装备唯一 id，英文小写 + 下划线 |
| `slot` | string | ✅ | 槽位 id，当前武器为 `arms` |
| `name` | string | ✅ | 中文显示名，用于指令查询 |
| `aliases` | string[] | MAY | 指令别名 |
| `heartbeat` | number | ✅ | `Date.now()`；注册脚本每 20 tick 刷新，10 秒未刷新视为过期 |
| `create` | function | ✅ | 无参函数，返回 `ItemStack`；返回 null / 抛异常视为构建失败 |

共享 API：

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `register(def)` | definition | boolean | 注册 / 覆盖装备 |
| `unregister(slot, id)` / `unregister(def)` | string, string / definition | void | 注销装备 |
| `heartbeat(slot, id)` | string, string | void | 刷新注册心跳 |
| `get(slot, id)` | string, string | definition / null | 按 id 精确查询 |
| `resolve(slot, query)` | string, string | definition / `{ambiguous}` / null | 按 id / 显示名 / 别名及唯一前缀查询 |
| `list(slot)` | string | definition[] | 列出槽位内存活装备 |
| `listSlots()` | - | string[] | 列出已有装备槽位 |
| `createItem(def)` | definition | ItemStack / null | 调用 `create()` 并写入通用 PDC 标记 |
| `isEquipItem(item)` | ItemStack | boolean | 是否为 GetEquip 发放的装备 |

约定：

1. `GetEquip.js` 会在装备 ItemStack 的 PDC 中写入 `get_equip_item_id = "<slot>:<id>"`；
   装备脚本应保留自己的 PDC 标记用于自身事件识别。
2. 装备脚本卸载 / 热重载时必须注销注册；心跳超时只作为兜底。
3. **E 键限制**：Paper 1.21.8 纯原版客户端按 E 打开“玩家自身背包”不会向服务端发送打开容器数据包，
   `InventoryOpenEvent` 通常不会触发，不能把它当作可靠的 E 键事件源；需要按键技能时应选用会发包的
   `PlayerDropItemEvent`、`PlayerSwapHandItemsEvent`、`PlayerInteractEvent` 等，或由客户端模组发送自定义数据包。


## 7. 投射物与爆炸契约

### 7.1 投射物生成

**MUST** 按以下顺序生成火球类投射物：


```js
var fireball = world.spawn(spawnLocation, entityClass);
fireball.setShooter(boss.carrier);
fireball.setDirection(direction);
fireball.setVelocity(direction.clone().multiply(speed)); // 必须：新实体初速度为 0
fireball.addScoreboardTag(PROJECTILE_TAG);
trackedProjectiles[uuid] = {
    proj: fireball,
    kind: "fireball",
    power: floatPower,
    trail: trailType,
    life: 240,
    breakBlocks: true
};
```

### 7.2 自定义 float 爆炸

**MUST** 通过以下路径实现小数威力：

1. 注册 `ProjectileHitEvent`，仅处理 `PROJECTILE_TAG` / `trackedProjectiles` 中的投射物。
2. 取消原版命中：`event.setCancelled(true);`。
3. 记录命中位置（方块命中取方块中心 + BlockFace，实体命中取投射物位置）。
4. 调用 Java 爆炸 API（固定 5 参数重载）：
   ```js
   world.createExplosion(location, power, false, breakBlocks === true, null);
   ```
5. 大型火焰弹额外注册 `ExplosionPrimeEvent`，对我的火球执行 `event.setCancelled(true)`，防止原版整数爆炸。
6. 末影龙龙息弹额外注册 `EnderDragonFireballHitEvent`，执行 `event.setCancelled(true)`，防止生成 `AreaEffectCloud`。
7. 命中后删除或标记 `trackedProjectiles`；下一 tick 主循环统一清理无效实体。

### 7.3 威力与破坏方块约定

| 投射物 | 默认威力 | 默认 `breakBlocks` | 说明 |
| --- | --- | --- | --- |
| 小型火球雨 | 1.75（半血 2.25） | `true` | 当前配置为破坏方块；如担心场地损耗可改为 `false` |
| 大型火焰弹 | 4.5（半血 5.0） | `true` | 12 tick 红色预警后发射 |
| 末影水晶火球 | 6.5 | `true` | 超级冲撞结束时发射 |
| 死亡火球雨 | 2.75 | 跟随小型火球雨 | 密度与频率同小型火球雨 |
| 半血大爆炸 | 10.0 | `true` | `detonate` |
| 死亡大爆炸 | 13.0 | `true` | `detonate` |

所有威力必须是 JS number（Nashorn 自动转 float），禁止用字符串或未定义变量传参。`PHASE2_FIREBALL_BONUS = 0.5` 会同时作用于大小火球。

### 7.4 预警粒子契约

| 预警 | 时长 | 粒子 | 行为 |
| --- | --- | --- | --- |
| 大型火焰弹 | `LARGE_FIREBALL_WARNING_TICKS=12` | 红色 `DustOptions` | 每 tick 从 BOSS 到目标画红色 DUST 激光；结束时沿最后方向发射 |
| 冲撞 | `CHARGE_TELEGRAPH_TICKS=8` / `SUPER_CHARGE_TELEGRAPH_TICKS=8` | 黄色 `DustOptions` | 沿冲锋方向画黄色 DUST 激光 + BOSS 周围黄色粒子环 |

要求：

- 必须使用 `Particle.DUST` + `new DustOptions(Color.fromRGB(...), size)`，禁止 `Particle.REDSTONE`。
- 预警期间若 BOSS 被硬直/吸附/致命伤害打断，必须调用 `cancelLargeFireballWarning(boss)`。
- 预警结束发射后，必须重置 `boss.largeFireballWarning = null` 并走正常冷却。

### 7.5 火种实体与阶段契约

| 项目 | 规则 |
| --- | --- |
| 生成方式 | `spawnFireSeedAt`：不可见 Husk + 岩浆块 `BlockDisplay`；东南西北 30 格各一个 |
| HP | `FIRE_SEED_MAX_HEALTH=20`，可被玩家正常击杀 |
| AI / 移动 | 无 AI、无攻击、无重力、不可拾取、静音 |
| 免疫 | `EntityDamageEvent` 中火种忽略 `isFireOrExplosionDamage`；其他伤害正常 |
| 标记 | `carrier.setGlowing(true)`（光灵箭标记效果） |
| 特效 | 每 2 tick 周围 `FLAME` + `LAVA` + `SMOKE` |
| 阶段视觉 | 火种阶段/回归动画隐藏龙卷风，只保留少量烟雾，突出煤炭块贴图 |
| 数量变量 | `boss.fireSeedCount` 独立保存；火种死亡 -1；清 0 立即进入死亡序列 |
| 20 秒阶段 | `FIRE_SEED_PHASE_TICKS=400`；倒计时结束 `startFireSeedAnimation` |
| 回归动画 | `FIRE_SEED_ANIMATION_TICKS=100`；随机二次贝塞尔曲线火焰漩涡飞向 BOSS |
| 恢复 | `fireSeedCount * FIRE_SEED_HEAL_PER_SEED`，并重置攻击冷却 |
| 清理 | `cleanupBoss`、`startDeathSequence`、`cleanupOrphans` 必须清理火种载具与显示实体 |

### 7.6 贴图旋转 / 漂浮契约

- `BlockDisplay` 的方块模型原点在方块角上。`setDisplayTransform` MUST 使用 `T = -R * (S * C)`，把方块中心映射到显示实体位置；只做“绕中心自转”补偿会让 Axiom 实体位置白块落在岩浆块左下角。
- 显示实体位置 MUST 放在碰撞箱中心：`DISPLAY_CENTER_Y = Husk 原始身高 * CARRIER_SCALE / 2`（当前为 `1.95 * 2 / 2 = 1.95`），而不是 `+1.10` 之类的角偏移。
- 正常阶段每 tick 自转，并叠加 `Math.sin(globalTick / 16.0) * 0.12` 的上下漂浮，模仿原版末影水晶。
- 火种阶段/回归动画：贴图改为 `COAL_BLOCK`，`spin=0`，停止自转。
- 死亡序列显示实体同样要加 `DISPLAY_CENTER_Y` 偏移，保持视觉中心一致。

### 7.7 BOSS 血条 key 与清理契约

- 血条 Key MUST 使用可识别前缀：`new NamespacedKey(plugin, (BOSS_ID + "_" + uuidCompact).toLowerCase())`。
- `removeBossBar(boss)` 使用 `boss.barKey` 精确移除当前 BOSS 血条。
- `cleanupBossBars()` 在脚本加载/清理时必须同时匹配：
  1. `namespace == plugin 命名空间` 且 key 以 `BOSS_ID + "_"` 开头（新版）；
  2. 旧版遗留 key 以 `if_` 开头；
  3. 兜底：血条标题包含 BOSS 显示名的遗留血条。
- 禁止只匹配单一前缀，否则热重载后会出现“血条残留、消失不了”的情况。
- 清理顺序：`bar.removeAll()` → 收集 key → `Bukkit.removeBossBar(key)`。

### 7.8 混合碰撞箱契约（Husk + Slime）

| 项目 | 规则 |
| --- | --- |
| 主载具 | `carrier` 使用 Husk/Zombie：负责寻路、移动、血条、阶段、火种、死亡；`AI=false`、`Gravity=false` |
| 副碰撞箱 | `slimeCarrier` 使用 `Slime`，`setSize(4)`（约 2.08×2.08）；`AI=false`、`Gravity=false`、`Invisible=true`（隐藏 Slime 贴图/模型）、静音、始终浮空；碰撞与命中判定仍然有效 |
| 位置同步 | 每 tick 在 `updateBoss` 之后调用 `syncHybridCollision(boss)`，让 Slime 碰撞箱中心与 Husk/BlockDisplay 中心重合；禁止让 Slime 接触地面或交给 AI 移动 |
| 伤害统一 | Slime 的 `EntityDamageEvent` 必须取消原伤害并调用 `handleHybridCollisionDamage`：玩家近战/投射物伤害、硬直倍率、远程计数、致命伤害全部走 Husk 同一套逻辑 |
| 双命中去重 | 必须使用 `lastDamageTick` + `lastDamageSource`：同一 tick 内同一攻击者命中 Husk 和 Slime 只结算一次，避免横扫之刃双倍伤害 |
| 计分板 | 创建 objective `inferno_foehn_hp`（16 字符以内）；每只 BOSS 的 `scoreKey = if_<uuid 前 12 位>`，分数与 Husk 当前 HP 同步 |
| 队伍 | 创建 `ijf_<uuid 前 12 位>` 队伍，把 Husk 与 Slime 的 UUID 字符串都加入，用于统一识别 / 名称归属；**`team.setPrefix("")` 必须为空**，否则原版 `/damage`、`/execute`、死亡消息等反馈会变成“[炎狱焚风] 炎狱焚风”，看起来像播报了两次 BOSS 名 |
| 清理 | `cleanupBoss`、`cleanupOrphans`、死亡序列结束都要移除 Slime、注销队伍、清空计分板条目 |
| 禁忌 | 不要把 Slime 交给 AI；不要用 `setVelocity` 积分位移（NoAI 下不可靠）；不要只处理其中一个碰撞箱的伤害 |

### 7.9 炎狱焚风困难模式契约（`-hard`）

- 注册独立定义 id `inferno_foehn_hard`，显示名 `炎狱焚风-完整`；普通定义不变。
- 召唤物：`/call boss 炎狱焚风-hard` 获得的烈焰棒 `stickName` 为 `[炎狱焚风-困难模式]`、`stickLore=[]`；召唤成功后必须移除玩家手中对应的召唤烈焰棒（`consumeOnSummon=true`）；召唤前 6 秒倒计时消息必须保留。
- BOSS 条：必须显示 `[炎狱焚风-完整]`；战斗聊天提示全部关闭，仅保留粒子预警与远程命中 actionbar。倒计时框架消息不属于战斗提示，保留。
- 玩家统计半径 256 格；**玩家数 > 10 时一律按 10 计算**。HP 召唤时快照 `300 + 400 × N`；火种 `N × 4`、半径 64 随机分布、12 秒窗口。
- 本体原生生命固定 20；真实生命必须由计分板 objective / `boss.hp` 承载，血条、半血判定、致命判定与回血全部读取计分板，不再受原版 `MAX_HEALTH` 1024 上限影响。
- 火球雨总量 `80 × N`，单次最多瞄准 `max(1, N-1)` 个目标；大火球每次 `N` 枚且每枚不同目标。
- 冲撞结束 5 tick 后必须发起下一次（带预警），直到所有目标都被撞过一次；每 5 tick 刷新目标列表：普通模式为半径 256 格内玩家，无差别模式为半径 256 格内 `LivingEntity`（按距离排序、上限 10）；被选中的目标必须标记完成以保证队列推进，贴脸/撞墙时必须补一次接触伤害结算。
- 远程硬直 10 次；非僵直期间护甲 15、韧性 10，硬直期间降为 0。
- 吸附激光同时吸附所有目标且拉速 ×3；杀戮光环每 tick 结算。
- 超级冲撞水晶速度 ×2、数量 `max(1, N-1)` 且瞄准不同玩家；中毒替换为凋零 15 秒。
- 半血自爆威力 18、前摇 3 秒；死亡自爆威力 35、前摇 8 秒；死亡火球密度更高、多数瞄准玩家、单发威力 4.0；移动速度 ×1.25。

### 7.10 计分板生命契约（所有脚本怪物强制）

从 v1.5.0 起，所有脚本怪物（BOSS、精英怪、召唤物）必须使用计分板承载有效生命，禁止把 `carrier.getHealth()` 当作有效生命。

**强制规则：**

1. **本体原生生命固定 20**：`MAX_HEALTH=20`、`setHealth(20)`；禁止用 `MAX_ABSORPTION`、吸收护盾或 >1024 的原版最大生命承载大血量。
2. **计分板 objective**：每类怪物创建/复用一个 objective（如 `inferno_foehn_hp`）；每个单位一个 `scoreKey`，分数为当前生命（显示取整，内部保留 float 字段 `boss.hp`）。
3. **所有伤害必须拦截**：
   - `EntityDamageEvent` / `EntityDamageByEntityEvent` 中，对本脚本怪物 `event.setCancelled(true)`；
   - 先处理免疫（火焰/爆炸等）与阶段无敌，再计算最终伤害；
   - 统一调用 `damageBossByScoreboard(boss, amount)`（或同类函数）扣计分板；
   - 扣血期间本体始终保持 20 HP，不调用 `carrier.setHealth` 扣血。
4. **计分板归零**：将计分板设为 0，并调用 `carrier.setHealth(0.0)` 清空本体生命；由 `EntityDeathEvent` 统一进入火种/死亡/自爆流程。`EntityDeathEvent` 中如取消死亡，必须把本体恢复到 20 HP。
5. **回血/阶段/血条**：BossBar 进度、半血判定、致命判定、火种回血、调试命令全部以 `boss.hp` / 计分板分数为准。
6. **混合碰撞箱/分身**：副碰撞箱与幻影的伤害也必须走同一计分板扣血入口，禁止只改本体 `setHealth`。
7. **困难模式动态血量**：直接写入计分板，支持任意大数值。

**禁止：**

- 使用 `carrier.getHealth()` / `carrier.setHealth()` 作为脚本怪物的有效生命；
- 使用吸收护盾、`MAX_ABSORPTION` 承载脚本生命；
- 伤害事件不取消、直接让原版扣本体生命；
- 只处理本体、不处理副碰撞箱/分身的伤害。

---

### 7.11 AllMusic 阶段 BGM 契约（InfernoFoehn）

适用脚本：`InfernoFoehn.js` 的普通与困难模式。依赖服务端 AllMusic 4.2.5（实测）与客户端 mod。

**强制规则：**

1. 一阶段循环 `霊知の太陽信仰 ～ Nuclear Fusion`（`netapi` ID `22636637`）；半血引燃、火种阶段、火种回归期间循环 `Armageddon`（`1495879966`）。
2. AllMusic 没有单曲循环 API，必须由脚本维护队列副本。反射入口通过
   `Bukkit.getPluginManager().getPlugin("AllMusic").getClassLoader()` 加载：
   - `PlayMusic.nowPlayMusic`：当前 `SongInfoObj`；
   - `PlayMusic.playList`：私有静态播放队列；
   - `AllMusic.MUSIC_APIS`：按 API id 取 `netapi.NetiApiMain`；
   - `IMusicApi.getPlayUrl(String)`：预解析播放链接。
3. 队列中同一阶段 BGM 必须保持恰好一份副本，并位于玩家队列之前；当前曲目结束时副本无缝接唱。脚本每 10 tick 维护一次，失败时 5 秒重试。
4. 切阶段前必须预解析下一阶段 BGM 的 `playerUrl` 并写回 `SongInfoObj.playerUrl`；链接未就绪不得清空当前 BGM / 发送 `/music next`，避免长时间静音或空闲歌单插播。
5. **死亡自爆胜利曲**：`startDeathSequence()` 必须切换到 `UNICUBE!`（`netapi` ID `3368128694`），且不得加入循环副本，只播放一次。
6. **胜利曲计时**：从 `nowPlayMusic` 实际变为胜利曲的 tick 起计时 `BGM_VICTORY_DURATION_TICKS = 77 × 20`（1 分 17 秒）；到时必须移除队列中的胜利曲并对当前胜利曲执行 `/music next`，切回 AllMusic 默认歌单。胜利曲已开始播放后被手动切走视为结束，不再强行续播。
7. 胜利曲期间若召唤新 BOSS，战斗 BGM 优先；胜利曲计时照常进行，超时后清理胜利曲状态，不得覆盖新 BOSS 的战斗 BGM。
8. 实体异常清理、脚本卸载、服务器关闭时必须停止 BGM 并清除队列中的阶段 BGM 与胜利曲条目。
9. 主线程停止路径可用控制台 `music next`；异步卸载路径禁止 `Bukkit.dispatchCommand`（Paper AsyncCatcher），必须反射把 `PlayMusic.musicLessTime` 置 10 结束当前播放。
10. BGM 为全服共享；任意一只 BOSS 进入第二阶段即播放二阶段 BGM，所有 BOSS 死亡后进入胜利曲窗口。没有在线玩家时不发送点歌命令；BOSS 区块未加载或 BOSS 周围 256 格内没有玩家时也必须停止并清除 BGM。
11. AllMusic 版本升级后字段 / 方法名可能变化，必须重新实测；当前实现跳过歌词加载（写入 `playerUrl` 会走 AllMusic 的“无歌词”分支）。

**禁止：**

- 直接拼接网易云播放 URL 或依赖客户端命令点歌；
- 在异步线程调用 Bukkit API / `dispatchCommand`；
- 每 tick 反射遍历大地图实体或反复添加同一 BGM 导致队列膨胀；
- BOSS 已清理仍保留 `task.thread` 预加载回调之外的长生命周期 BGM 状态。

---

### 7.12 Resurrection 旁观者倒计时契约（Resurrection.js）

**指令：**

- `/resurrection <秒数>`，整数，单位秒，范围 `1 ~ 600`；`addCommand` 权限参数为空，命令方块可直接执行。
- 执行位置：`BlockCommandSender.getBlock().getLocation()`；玩家手动执行时使用玩家位置（便于测试）。
- 目标：同世界内距离执行位置最近的在线、非死亡玩家。

**行为：**

1. 保存目标当前 `GameMode`、`allowFlight`、`isFlying`；把 `GameMode` 写入玩家 PDC（`openjs:resurrection_prev_mode`）作为兜底。
2. `player.setGameMode(GameMode.SPECTATOR)`，私发文本 `已经切换为旁观者模式，请尽快前往死亡地点`。
3. 每个游戏 tick 递减 `endTick = 开始 tick + 秒数 × 20`；每秒刷新 actionbar `旁观者模式剩余 X 秒`，剩余 10 / 5 / 3 / 2 / 1 秒时额外发送 title，最后 3 秒红色。
4. 到时恢复 `previousGameMode` / `allowFlight` / `isFlying`，清除 PDC 标记，并提示倒计时结束。
5. 同一玩家重复触发时保留最初保存的模式，只刷新 `endTick`。
6. `PlayerQuitEvent` 时立即恢复并清除标记；`PlayerJoinEvent` 与脚本加载后的 `task.main` 检查 PDC 标记并兜底恢复。
7. `task.bindToUnload` 尽力恢复；异步线程调用 Bukkit 失败时必须保留 PDC 标记，由下次加入 / 新脚本实例恢复。

**禁止：**

- 使用 `task.delay` 安排最终恢复（脚本卸载会取消，玩家会卡在旁观者）；
- 把目标玩家当前模式直接写死为 SURVIVAL / CREATIVE；
- 只改游戏模式而不恢复飞行状态；
- 允许控制台执行时随机挑玩家（当前设计仅命令方块 / 玩家提供位置）。

---

### 7.13 下界之星复活契约（StarResurrection.js）

**指令：**

- `/starresurrection <all|玩家名> <true|false>`；`addCommand` 权限参数为空，控制台 / 玩家 / 命令方块均可执行。
- `all` 设置全体默认开关并清空个人覆盖；`玩家名` 必须是当前在线玩家（大小写不敏感），设置个人覆盖，个人覆盖优先于 all。
- 不带参数输出全局状态、个人覆盖列表与用法。

**效果与状态：**

1. 开启后，玩家受到致命伤害或死亡时，若主背包 0~35 格或副手存在下界之星，扣除 1 枚并复活，保留 `1` 点生命。
2. 复活同时给予原版不死图腾同款效果：生命恢复 II 45 秒、伤害吸收 II 5 秒、抗火 I 40 秒，并播放图腾音效与粒子。
3. 状态 PDC key `openjs:star_resurrection_state`，字符串格式 `all:1|uuid:1|uuid:0`；`uuid` 为玩家 UUID，个人覆盖优先于 all；`all` 指令会清空个人覆盖。
4. 同一玩家同一 tick 只允许一次复活结算（`Bukkit.getCurrentTick()`），防止同一 tick 多个伤害 / 死亡事件重复扣星。
5. 创造 / 旁观模式玩家不触发；无下界之星时不取消事件，走正常死亡流程。

**事件规则：**

- `EntityDamageEvent`：`player.getHealth() - event.getFinalDamage() <= 0` 时扣星、`setCancelled(true)`，再把生命设为 1；
- `PlayerDeathEvent`：作为 `/kill` 等绕过普通伤害事件的兜底，扣星后 `setReviveHealth(1.0)` 并 `setCancelled(true)`；
- `consumeNetherStar` 按物品类型匹配，可兼容自定义名称的下界之星；主背包逐格扣除，副手单独处理。

**禁止：**

- 把复活血量写成 > 玩家最大生命或 0；
- 只处理 `PlayerDeathEvent` 而忽略致命伤害（会让玩家先进入死亡结算 / 掉落流程）；
- 不检查个人覆盖与 all 的优先级；
- 扣星后不取消事件或重复扣星。

---

## 8. 战斗事件契约

### 8.1 伤害事件模板

```js
registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
    try {
        var boss = getBossByEntity(event.getEntity());
        if (!boss) return;

        if (boss.dead || boss.transitioning) {
            event.setCancelled(true);
            return;
        }

        var source = event.getDamageSource();
        var attacker = source != null ? source.getCausingEntity() : null;
        if (attacker == null && source != null) attacker = source.getDirectEntity();
        if (attacker != null && !(attacker instanceof PlayerClass)) {
            event.setCancelled(true);
            return;
        }

        if (isFireOrExplosionDamage(event.getCause())) {
            event.setCancelled(true);
        }
    } catch (e) {
        log.error("BOSS 受伤事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
    }
});
```

### 8.2 近战 / 远程事件规则

- `getDamager() instanceof Player`：近战；硬直期间 `event.setDamage(event.getDamage() * 1.5)`。
- `getDamager() instanceof Projectile` 且 `getShooter() instanceof Player`：远程命中；累加 `boss.rangedHitCount`，达到阈值触发硬直。
- 事件回调 MUST 整体 `try/catch`，异常只记录日志，不得让服务器事件总线抛异常。

### 8.3 硬直规则（以炎狱焚风为例）

- 远程命中 6 次 → `staggerTicks = 100`；
- 硬直期间：不移动、不冲撞、不大型火球、光环消失、近战伤害 ×1.5；
- 半血后硬直结束瞬间：`startCharge(boss, target, true)`。

### 8.4 吸附激光规则

- 只允许半血后触发；
- 目标为 `findFarthestPlayer(boss)`；
- 每 tick 拉向 BOSS 中心，并保持浮空；
- 玩家 `PlayerTeleportEvent`（末影珍珠/传送）时立即 `endAttract`；
- 被吸附期间，该玩家的光环伤害 ×2。

### 8.5 致命伤害 / 火种阶段规则

- `EntityDamageEvent` 中，BOSS 未死亡且 `health - event.getFinalDamage() <= 0` 时：
  1. `event.setCancelled(true)`；
  2. `startFireSeedPhase(boss)`，不要让它死亡。
- 火种阶段/回归动画期间，BOSS 所有伤害必须取消；`EntityDamageByEntityEvent` 不得再累计远程命中或近战易伤。
- `EntityDeathEvent` 仅作为 `/kill` 等绕过路径兜底：若 `fireSeedCount > 0` 且未处于火种阶段/动画，取消死亡并 `startFireSeedPhase`。
- 火种死亡走 `removeFireSeed(seedUuid, true)`：移除显示实体、`fireSeedCount--`；减到 0 调用死亡自爆序列。

### 8.6 投射物发射时机规则

- 大型火焰弹：先 12 tick 红色预警，再发射；
- 冲撞：先 8 tick 黄色预警，再进入 dash；
- 超级冲撞的末影水晶火球：必须在 `endCharge` 中发射，禁止在 dash 开始时同步发射；
- 所有投射物必须有 `PROJECTILE_TAG`、初速度、寿命登记，并在 BOSS 死亡/脚本卸载时清理。

---

### 8.7 玩家事件可用性清单（自定义装备 / 技能触发，2026-09-30 实测）

> **⚠️ 重点（MUST 先读）**
>
> - 自定义装备 / 技能的主动触发 MUST 优先从 `PlayerInteractEvent`、`PlayerInteractAtEntityEvent`、`PrePlayerAttackEntityEvent` 中选择。
> - `PlayerInteractEvent` 会因主手 / 副手而重复触发，处理前 MUST 过滤 `EquipmentSlot.HAND`。
> - E 打开玩家自身背包不会有 `InventoryOpenEvent`；只有关闭背包时会触发 `InventoryCloseEvent(CRAFTING, PLAYER)`，因此 MUST NOT 把 `InventoryOpenEvent` 当作 E 键触发器。
> - F 的 `PlayerSwapHandItemsEvent` 本身会触发；若判定 F 方案不可行，MUST 是能力设计冲突结论，不能写成“服务器收不到 F 事件”。

实测环境：Paper 1.21.8 / OpenJS 1.5.0 / 玩家 XP 实机按键；完整操作过程见《可能有用的开发资料.md》7.26。

| 操作 | 可用事件 | 备注 |
| --- | --- | --- |
| Q 丢弃 | `PlayerDropItemEvent` | ✅ 拦截丢出并改技能的成熟方案 |
| F 换手 | `PlayerSwapHandItemsEvent` | ✅ 事件触发；注意与技能抢占换手行为 |
| 右键空气 / 方块 | `PlayerInteractEvent`：`RIGHT_CLICK_AIR`、`RIGHT_CLICK_BLOCK` | ✅ 最推荐的主动技能触发；右键方块会触发主副手两份事件 |
| 左键空气 / 方块 | `PlayerInteractEvent`：`LEFT_CLICK_AIR`、`LEFT_CLICK_BLOCK` | ✅ 可用；与挖掘 / 攻击共用左键 |
| 左键摆动 | `PlayerAnimationEvent`（`ARM_SWING`）、Paper `PlayerArmSwingEvent` | ✅ 可用；二者可能同时触发，建议只监听一个 |
| 右键实体 | `PlayerInteractAtEntityEvent`（优先）、`PlayerInteractEntityEvent` | ✅ 盔甲架实测只触发 At 变体；生物两者可能都触发，需去重 |
| 攻击动作 | `PrePlayerAttackEntityEvent` | ✅ 优先用于攻击触发；`EntityDamageByEntityEvent` 可能因无敌 / 取消不触发 |
| 潜行 | `PlayerToggleSneakEvent` | ✅ 可用 |
| 冲刺 | `PlayerToggleSprintEvent` | ✅ 可用 |
| 跳跃 / WASD 组合 | `PlayerInputEvent` | ✅ 可用；只能看到移动 / 跳跃 / 潜行 / 冲刺状态，不含 E / F / Q |
| 移动 / 转向 | `PlayerMoveEvent` | ✅ 可用但高频；直接触发技能 MUST 防抖或加条件 |
| 创造双击跳跃 | `PlayerToggleFlightEvent` | ✅ 仅创造模式可靠 |
| 快捷栏切换 | `PlayerItemHeldEvent` | ✅ 可用 |
| 聊天消息 | Paper `AsyncChatEvent`（优先）、旧 `AsyncPlayerChatEvent` | ✅ 可用 |
| 斜杠命令 | `PlayerCommandPreprocessEvent` | ✅ 可用 |
| 按 E 打开自身背包 | 无事件 | ❌ `InventoryOpenEvent` 不触发 |
| 关闭自身背包 | `InventoryCloseEvent` | ✅ 可触发 `CRAFTING` + `PLAYER`；只能检测关闭，不能检测打开 |


### 8.8 杜兰达尔技能契约（`Durendal.js`）

> **⚠️ 重点**
>
> - 亡灵判断 MUST 使用 `Tag.ENTITY_TYPES_UNDEAD.isTagged(entity.getType())`；MUST NOT 调用 `LivingEntity#getCategory()`，Paper 1.21.8 会抛 `UnsupportedOperationException: Method no longer applicable. Use Tags instead.`。
> - 原版服务端收不到“按键按住 / 松开”事件，只收到 `PlayerItemHeldEvent` 的槽位变化；1 键蓄力 MUST 按“开始 / 释放”近似规则实现，并在脚本头或技能说明中写明。
> - 技能造成的伤害（金块、金色剑气）MUST 使用非玩家源实体（BlockDisplay / Snowball）或等价隔离手段，避免误触发杜兰达尔的亡灵 +4 和普通近战逻辑。

装备与数值：

| 项目 | 规则 |
| --- | --- |
| 基础物品 | `Material.GOLDEN_SWORD`，主手攻击伤害 12（+11），攻击速度 1.6（-2.4），无限耐久 |
| 附魔 | 仅有附魔光效（glint override true），MUST 拦截附魔台 / 铁砧 / `/enchant` |
| 亡灵增伤 | 主手杜兰达尔 + `ENTITY_ATTACK` / `ENTITY_SWEEP_ATTACK`，目标在 `ENTITY_TYPES_UNDEAD` 标签内时 `event.setDamage(event.getDamage() + 4)` |
| Q 治疗 | `PlayerDropItemEvent` 拦截丢剑；恢复 15 生命，冷却 200 tick；满血不消耗冷却 |
| 1 键至圣斩 | `PlayerItemHeldEvent.newSlot == 0` 且触发者持有 / 选中杜兰达尔时开始蓄力；蓄力上限 60 tick；每 tick 射程 +1.5、威力 +1，每 10 tick 碰撞半径 +0.2；释放后 120 tick 冷却 |
| 1 键释放 | 服务器无法监听按键松开；当前实现为“按其他快捷栏键 / 按 4 提前释放，或蓄满 3 秒自动释放” |
| 至圣斩金块投射物 | `BlockDisplay` 显示 `GOLD_BLOCK`，金色 DUST 尾迹，速度 1.5 格/tick；MUST 每 tick 对“上一位置 → 下一位置”线段做实体路径碰撞检测，命中后在碰撞半径内造成等于蓄力威力的伤害并击退；只检查到达点会因速度过快穿过生物导致 0 伤害 |
| 4 键剑气 | `PlayerItemHeldEvent.newSlot == 3`；金色 DUST 剑气，射程 16、速度 1 格/tick、伤害 10、冷却 15 tick；使用不可见 Snowball 作为伤害源 |
| Lore | MUST 写入：基础伤害 12、亡灵 +4、Q 治疗 15（10 秒）、长按 1 至圣斩（最多 3 秒 / 6 秒）、按 4 金色剑气（10 伤害 / 15 tick） |

实测：物品属性、Q 治疗 4→19、僵尸伤害 12→16、1 键至圣斩后 4 键同时生成金块 `BlockDisplay` 与金色剑气源实体均通过；修复实体路径碰撞后，200 HP 僵尸被 5 tick 至圣斩命中 200→194（基础 1 + 5 = 6 伤害）；临时测试脚本与实体已清理。


### 8.9 索命剑技能契约（`SoulReapingSword.js`）

> **⚠️ 重点**
>
> - 所有反噬伤害 MUST 通过 `player.damage(amount)`（单参数）造成，不能传玩家自己作为伤害源，否则会递归触发索命剑的命中反噬逻辑。
> - Q 红色剑气 MUST 维护“是否命中过目标”的状态；命中过任意目标则不反噬，只有到达射程 / 撞到方块且从未命中时才反噬施放者。
> - 左键挥空 MUST 仅在 `PlayerInteractEvent` 的 `LEFT_CLICK_AIR` + `HAND` 且主手为索命剑时触发，不能把正常挖掘 / 攻击也计入挥空。

装备与数值：

| 项目 | 规则 |
| --- | --- |
| 基础物品 | `Material.NETHERITE_SWORD`，主手攻击伤害 20（+19），攻击速度 1.6（-2.4），无限耐久 |
| 附魔光效 | `setEnchantmentGlintOverride(false)`；即使被附魔也不显示光效 |
| Q 红色剑气 | `PlayerDropItemEvent` 拦截丢剑；红色 DUST 剑气，射程 16、速度 1 格/tick、伤害 15；Snowball 作为伤害来源 |
| Q 未命中反噬 | 剑气从未命中任何实体且到达射程 / 撞到方块时，反噬施放者 15 伤害 |
| 左键挥空反噬 | `PlayerInteractEvent.LEFT_CLICK_AIR` + 主手索命剑时，对施放者造成 2 伤害（技能常量） |
| 命中反噬 | `EntityDamageByEntityEvent` 且来源为 `ENTITY_ATTACK / ENTITY_SWEEP_ATTACK`；普通 25% 反噬一半最终伤害；跳劈 50% |
| 跳劈判定 | `event.isCritical()` 或玩家未落地且 `fallDistance > 0` |
| Lore | MUST 写入：基础伤害 20、Q 红色剑气（伤害 15）、以及“每次挥剑必定见血的诅咒之剑” |

实测：Q 命中目标造成 15 伤害且玩家不反噬；Q 未命中和左键挥空均成功反噬施放者；物品属性与光效状态已确认。


### 8.10 魔弹射手技能契约（`MagicBulletShooter.js`）

> **⚠️ 重点**
>
> - 魔弹射手 MUST 通过 `EntityShootBowEvent` 的 `getBow()` PDC 识别，并 `setCancelled(true)` 拦截原版箭矢；不能按材质误伤普通弩。
> - 拦截后 MUST 调用 `setConsumeArrow(false)` / `setConsumeItem(false)`，避免取消箭矢后仍消耗弹药。
> - 激光固定 64 格，沿途所有 `LivingEntity` 各结算一次伤害且 MUST NOT 做队伍过滤（不区分队员）。
> - 第 7 发隐藏特性 MUST 不写入 Lore；单人模式无目标时直接对自己造成 40 伤害（保留伤害翻倍）。

装备与数值：

| 项目 | 规则 |
| --- | --- |
| 基础物品 | `Material.CROSSBOW`，无限耐久 |
| 隐藏附魔 | 真实附魔 `PIERCING=5`、`QUICK_CHARGE=4`；`HIDE_ENCHANTS` 隐藏附魔文字并保留附魔光效 |
| 射箭拦截 | `EntityShootBowEvent`：识别 PDC 后取消原版箭矢、禁止消耗箭矢，改为发射蓝色 DUST 激光 |
| 激光范围 | 固定 64 格贯穿；每只沿途 `LivingEntity` 只结算一次伤害；不区分队伍 / 队员 |
| 普通激光伤害 | 20 |
| 第 7 发特殊激光 | 连续射击第 7 发；优先锁定同一 scoreboard 队伍在线玩家，无队伍时回退同世界其他在线玩家 |
| 单人模式 | 第 7 发没有可选目标时，直接对自己造成 40 伤害，不产生激光 |
| 特殊激光伤害 | 40（保留伤害 ×2） |
| 第 7 发后 | 射击计数清零 |
| Lore | MUST 写入：基础伤害 20、64 格蓝色激光、攻击沿途所有敌人（不区分队员）；MUST NOT 写入第 7 发隐藏特性 |

实测：两个 100 HP 僵尸分别位于 6 格 / 12 格，单次普通激光各命中一次并均变为 80 HP；实体箭矢被拦截取消。


## 9. 日志、提示与错误处理契约

1. 日志前缀 MUST 带脚本 / BOSS 名：`log.info("InfernoFoehn ...")`。
2. 异常日志 MUST 带 `e.stack`；不得只写 `e`。
3. 粒子、音效、提示类失败 MAY 静默；涉及状态机、投射物、爆炸、玩家生命值的失败 MUST 记录。
4. 玩家提示统一使用 `ChatColor`；BOSS 提示建议带 `[BOSS名]` 前缀。
5. 生产脚本中禁止 `TEST` / `DEBUG` / `_tmp_` 诊断日志。
6. 临时测试脚本文件名必须以 `_tmp_` 开头，测试完 MUST 删除并 `/oj reload`。

---

## 10. 质量门禁（Definition of Done）

任何脚本改动完成后，必须全部满足：

- [ ] `node --check <脚本>.js` 通过。
- [ ] `/oj reload <脚本>.js` 成功，日志出现 `Loaded the script ...`。
- [ ] 日志无 `ERROR`、`tick 异常`、`XXX异常`、`NoSuchMethodException`。
- [ ] `/call boss` 能列出 BOSS；右键烈焰棒出现 6 秒倒计时。
- [ ] 无临时 `_tmp_*.js`、临时实体、临时 BossBar、临时 PDC/Tag 残留。
- [ ] 大型火焰弹能看到 12 tick 红色 DUST 预警；冲撞能看到 8 tick 黄色 DUST 预警。
- [ ] HP 归零会进入无敌火种阶段：煤炭块 / 停转 / 东南西北 30 格火种 / 20 HP / 发光 / 免疫火焰爆炸。
- [ ] 火种死亡数量递减正确；清完立即死亡自爆；20 秒回归动画按剩余数量回血；数量继承到下一次 HP 归零。
- [ ] 混合碰撞箱：分别命中 Husk 和 Slime 都扣同一血条；致命一击从任意一方进入火种阶段；Slime 全程浮空不弹跳；重载后 Slime/计分板队伍被清理。
- [ ] 无差别攻击模式：`/douququ <名字>`、`/douququ all`、`/douququ off` 生效；普通模式下非玩家靶子不掉血，开启后可被 BOSS 锁定伤害；开启模式的 BOSS 也会受到普通生物/投射物/其他脚本 BOSS 的伤害；脚本 BOSS 能互相攻击；`all` 状态重载后保留。
- [ ] 炎狱焚风困难模式：`/call boss 炎狱焚风-hard` 可获得 `[炎狱焚风-困难模式]` 烈焰棒；召唤后烈焰棒被移除；BOSS 条为 `[炎狱焚风-完整]`；HP/火种/火球雨按玩家数（上限 10）缩放；多目标大火球、连续冲撞、10 次硬直、15/10 护甲、全玩家吸附、凋零水晶、强化自爆均生效；战斗聊天提示关闭。
- [ ] 计分板生命：本体保持 20 HP；伤害事件被取消并只扣计分板；计分板归零时本体生命被清空并正确进入火种/死亡流程；血条、半血、回血读取计分板；困难模式动态 HP 不受 1024 上限影响。
- [ ] 超级冲撞的水晶火球在冲撞结束时发射，不在开始时同步发射。
- [ ] 实战验证：BOSS 可生成、可受伤、可阶段转换、可死亡；TPS ≥ 19.5。
- [ ] 数值与需求逐条对照（威力、范围、持续时间、冷却、倍率）。
- [ ] 修改前已生成 `.bak-日期` 备份。
- [ ] 已更新《可能有用的开发资料.md》与/或本契约的相关 schema。
- [ ] 已清理 `logs\latest.log` 中可由本次改动避免的报错。

---

## 11. 禁止清单（Anti-patterns）

| 禁止 | 原因 |
| --- | --- |
| 在顶层写 `var Material = Java.type(...)` | 污染全局，脚本间互相覆盖 |
| `task.delay(...)` 中直接访问世界/实体 | AsyncCatcher / 线程安全问题 |
| `world.createExplosion(location, power, false, breakBlocks)` | Nashorn 重载歧义，运行时异常 |
| `fireball.setYield(1.5)` 期望小数爆炸 | Paper 1.21.8 实测无效或只支持整数 |
| 使用 `Particle.REDSTONE` 做彩色粒子 | Paper 1.21.8 不存在；必须用 `Particle.DUST` + `DustOptions` |
| `BlockDisplay` 只设置旋转四元数不补偿平移 | 方块会绕角原点公转，而不是自转 |
| 火种阶段仍让 `updateBoss` / 伤害事件继续 AI 或远程计数 | BOSS 会“无敌但仍在打人/被计数”，机制失效 |
| 只给 Husk 配受击逻辑、忽略 Slime 命中 | 玩家打中可见的 Slime 碰撞箱却不掉血 |
| 让 Slime 交给 AI 或靠 `setVelocity` 自行位移 | 会触发史莱姆弹跳/卡顿；混合方案中 Slime 必须只做浮空碰撞箱并每 tick 同步 |
| BOSS 目标/伤害扫描硬编码 `world.getPlayers()` | 无差别模式下无法锁定非玩家生物；必须通过 `DouQuQu.isActive` 切换到 `getLivingEntities()` |
| 伤害事件只允许 `PlayerClass` 来源 | 脚本 BOSS 互相攻击会被取消；必须放行 `DouQuQu.isActiveEntity(attacker)` 及其投射物 shooter |
| 接入 DouQuQu 后忘记每 tick `markEntity` | `isActiveEntity(attacker)` 永远为 false，BOSS 之间打不出伤害 |
| 用固定常量 4 代替 `boss.fireSeedCount` | 火种数量无法跨阶段继承，清完火种后仍会复活 |
| 使用未加 BOSS id 前缀的 Tag / PDC key | 多个 BOSS 互相误删、误识别 |
| 在 `EntityDamageByEntityEvent` 直接 `getDamager()` | 基类伤害事件会抛异常 |
| 把临时测试脚本/调试日志留在 scripts 目录 | 自动重载会持续执行，污染生产 |
| 直接删除契约中的状态字段 | 其他脚本/后续版本会读取失败；必须走版本迁移 |

---

## 12. 变更管理契约

1. **契约版本**：格式或 schema 变更 → 升 minor；破坏性字段变更 → 升 major。
2. **脚本头注释**：新增/修改机制时更新“机制摘要”和日期。
3. **备份**：改动前复制 `Xxx.js.bak-日期`。
4. **测试**：按第 10 节门禁执行。
5. **文档**：同步更新《可能有用的开发资料.md》第 7 节与第 9 节。
6. **迁移**：旧脚本未使用 IIFE 时，优先按第 2 节模板迁移；迁移完成前不得与已迁移脚本共享同名全局变量。

---

## 附录 A：标准脚本骨架（可直接复制）

```js
/*
 * FrostWarden.js —— 自定义 BOSS「霜狱典狱长」（OpenJS 1.5.0）
 *
 * 获取方式：/call boss 霜狱典狱长
 * 召唤方式：烈焰棒右键地面 → 6 秒倒计时
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    // var Material = Java.type("org.bukkit.Material");
    // ...

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    // var BOSS_ID = "frost_warden";
    // ...

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    // var activeBosses = {};
    // ...

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    // ...

    // -----------------------------------------------------------------------
    // 生命周期
    // -----------------------------------------------------------------------
    // function spawnFrostWarden(location, player) { ... }

    // -----------------------------------------------------------------------
    // AI / 技能
    // -----------------------------------------------------------------------
    // ...

    // -----------------------------------------------------------------------
    // 事件注册
    // -----------------------------------------------------------------------
    // registerEvent(...);

    // -----------------------------------------------------------------------
    // 主循环
    // -----------------------------------------------------------------------
    // task.repeat(ticks(1), ticks(1), function () { ... });

    // -----------------------------------------------------------------------
    // BossRegistry 注册
    // -----------------------------------------------------------------------
    // var bossDefinition = { ... };
    // ensureRegistered();
    // task.repeat(ticks(20), ticks(20), ensureRegistered);

    // log.info("FrostWarden 已加载：使用 /call boss 霜狱典狱长 获取召唤烈焰棒。");
})();
```

> 说明：骨架中的注释只是占位。实际脚本直接使用全局 `Java.type(...)`；不要把 `Java` 重新声明为变量。

---

## 附录 B：新增 BOSS 最短流程

1. 复制 `InfernoFoehn.js`，按第 2 节骨架改名与改 id。
2. 修改常量、Tag、PDC key、BossBar key、显示名。
3. 实现 `spawn` / 主循环 / 伤害免疫 / 死亡。
4. 按第 7 节实现投射物与 float 爆炸。
5. 按第 8 节实现近战/远程/硬直/阶段规则。
6. `/call boss <名字>` 获取烈焰棒，右键测试 6 秒倒计时。
7. 按第 10 节逐项过质量门禁。
8. 更新本契约的“现有脚本合规情况”与《可能有用的开发资料.md》。

---

## 附录 C：现有脚本合规情况（2026-10-02）

| 脚本 | IIFE + strict | 说明 |
| --- | --- | --- |
| `CallBoss.js` | ✅ | 新版召唤框架：绿宝石召唤物（兼容旧烈焰棒）、6 秒倒计时、BossRegistry Java 容器注册、对象式/位置参数式注册、`api.spawn`、旧字段兼容层 |
| `BanditTrio.js` | ⚠️ 待迁移计分板 HP | `bandit_trio` 流寇三人组：组合召唤 TitlelessKnight / Sharpshooter / WanderingWarlock |
| `TitlelessKnight.js` | ⚠️ 待迁移计分板 HP | `titleless_knight` 无爵骑士：HP200、Husk + 铁甲 + 锋利 V 下界合金剑；大剑三式 / 恐惧战吼 / 冲锋 |
| `Sharpshooter.js` | ⚠️ 待迁移计分板 HP | `sharpshooter` 神射手：HP100、Stray + 白皮甲 + 弓；四类箭 + 闪避瞬移 |
| `WanderingWarlock.js` | ⚠️ 待迁移计分板 HP | `wandering_warlock` 流浪术士：HP150、Skeleton + 金甲 + 书；戏法 / 1、2 级法术 / 护盾与法师护甲辅助 |
| `DouQuQu.js` | ✅ | 无差别攻击模式：`/douququ` 命令、PDC 持久化、共享 API、BOSS 互相攻击 |
| `InfernoFoehn.js` | ✅ | 炎狱焚风完整机制 + `-hard` 困难模式 + 计分板生命系统 + AllMusic 阶段 BGM（一阶段 / 二阶段无缝循环、死亡自爆 UNICUBE! 播放 77 秒后切回默认歌单）；队伍前缀置空修复 BOSS 名在命令反馈 / 死亡消息中重复播报，契约 v1.5.4 |
| `Resurrection.js` | ✅ | 命令方块专用 `/resurrection <秒数>`：最近玩家旁观者模式 + 私发提示 + actionbar/title 倒计时 + 恢复原模式；PDC 兜底重启/重载恢复，契约 v1.5.4 |
| `ThousandFacedWitch.js` | ✅ | 千面魔女；已修复 `ItemDisplay` 召唤异常与 `damage(amount, null)` 重载歧义；已接入 DouQuQu 无差别攻击模式 |
| `SuperTNT.js` | ✅ | 自定义 float 爆炸威力 TNT：`/supertnt [0.1~64]`；BlockPlaceEvent → TNTPrimeEvent → EntitySpawnEvent/主循环 → ExplosionPrimeEvent；取消原版整数爆炸并走 5 参数 `createExplosion` |
| `StarResurrection.js` | ✅ | `/starresurrection <all|玩家名> <true|false>`；致命 `EntityDamageEvent` 优先拦截，`PlayerDeathEvent` 兜底 `/kill`；消耗主背包 / 副手 1 枚下界之星原地复活（1 HP + 图腾效果）；主世界 PDC 持久化，契约 v1.5.5 |
| `KanKanSword.js` | ❌ 待迁移 | 仍有顶层 `var Material` 等；迁移时保持行为不变 |
| `CombatStats.js` | ❌ 待迁移 | 仍有顶层 `var Statistic` 等；迁移时保持 PAPI 变量名不变 |

> 迁移旧脚本时必须单独测试：`/papi parse`、`/as reload`、命令注册、事件回调均不能回归。

---

## 附录 D：契约更新记录

- 2026-10-02：升级 v1.6.0。导入新版 `CallBoss.js` 与四名新 BOSS（`BanditTrio.js` / `TitlelessKnight.js` / `Sharpshooter.js` / `WanderingWarlock.js`）。CallBoss 注册表改为 Java 容器 + `Java.extend(BiFunction)` 适配 spawn，支持对象式与位置参数式注册；新增 `has/getName/getAliases/describe/spawn`，`resolve` 返回 id 字符串，`list` 返回 id 数组，`createStick` 默认生成绿宝石并兼容旧召唤物 PDC key；保留 `stickName/stickLore/consumeOnSummon/silentSummon` 旧字段。同步更新 6.6 / 6.7 契约。实测 8 个 BOSS 注册、旧/新 BOSS 直接 spawn、模拟右键召唤与 `consumeOnSummon` 消耗均正常；四名新 BOSS 仍使用原版 HP，待迁移 7.10 计分板生命系统。

- 2026-09-30：升级 v1.5.11。修改魔弹射手契约：拦截 `EntityShootBowEvent` 后不再发射箭矢，改为 64 格蓝色贯穿激光，对沿途所有敌人各结算一次 20 伤害且不区分队伍；第 7 发锁定队员（scoreboard 队伍优先，无队伍回退其他在线玩家），单人模式直接反噬自身 40；第 7 发隐藏特性不写入 Lore。

- 2026-09-30：升级 v1.5.10。新增 8.10 魔弹射手契约：弩基础伤害 20、无限耐久、隐藏附魔文字的真实穿透 5 / 快速装填 4；普通箭每 2 tick 追踪最高 HP 敌人；第 7 发隐藏行为（随机玩家、每 tick 修正、伤害 40）；穿刺命中后保留伤害覆写状态。实测 1~8 发伤害 20/20/20/20/20/20/40/20。

- 2026-09-30：升级 v1.5.9。新增 8.9 索命剑契约：下界合金剑基础伤害 20、无限耐久、无附魔光效；Q 红色剑气伤害 15，未命中反噬自身 15；左键挥空反噬；命中 25% 反噬一半伤害，跳劈 50%；Lore 包含“每次挥剑必定见血的诅咒之剑”。重点要求反噬使用单参数 `player.damage` 避免递归，Q 剑气必须维护 `hitAny` 命中状态。

- 2026-09-30：升级 v1.5.8。修复杜兰达尔“至圣斩”（原金块蓄力）无伤害：金块投射物 MUST 每 tick 对移动线段做实体路径碰撞检测，不能只在到达点 / 射程终点结算；技能名统一为「至圣斩」。回归实测 200 HP 僵尸被 5 tick 蓄力命中后 200→194（基础威力 1 + 5）。

- 2026-09-30：升级 v1.5.7。新增 8.8 杜兰达尔技能契约：金剑基础伤害 12 / 亡灵 +4 / 无限耐久 / 附魔光效但无法附魔；Q 治疗 15（200 tick）；1 键蓄力金块（最多 60 tick，射程 +1.5、威力 +1 / tick，每 10 tick 碰撞体积增大，120 tick 冷却）；4 键金色剑气（伤害 10，15 tick 冷却）。重点记录 `LivingEntity#getCategory()` 在 Paper 1.21.8 不可用，亡灵判断必须改用 `Tag.ENTITY_TYPES_UNDEAD`。

- 2026-09-30：升级 v1.5.6。新增 8.7 玩家事件可用性清单：Q `PlayerDropItemEvent`、F `PlayerSwapHandItemsEvent`、右键 / 左键 `PlayerInteractEvent`、右键实体 `PlayerInteractAtEntityEvent`、攻击 `PrePlayerAttackEntityEvent`、潜行 / 冲刺 / 跳跃 / 快捷栏 / 聊天 / 命令事件均实测可用；E 打开自身背包无 `InventoryOpenEvent`，只有关闭时 `InventoryCloseEvent(CRAFTING, PLAYER)`；明确 `PlayerInteractEvent` 必须过滤 `EquipmentSlot.HAND`。
- 2026-09-30：升级 v1.5.5。新增 7.13 StarResurrection 契约与 `StarResurrection.js`：`/starresurrection <all|玩家名> <true|false>`；致命 `EntityDamageEvent` 优先拦截，`PlayerDeathEvent` 兜底 `/kill`；扣除主背包 / 副手 1 枚下界之星原地复活（1 HP + 生命恢复 II / 伤害吸收 II / 抗火 I + 图腾音效粒子）；状态存主世界 PDC `openjs:star_resurrection_state`，`all` 清空个人覆盖；实测 `/minecraft:damage XP 1000 minecraft:generic` 与 `/minecraft:kill XP` 各消耗 1 枚并存活。

- 2026-09-30：`EnderSword.js` Q 冷却增加经验条上方 actionbar 倒计时，每 tick 根据 `pearlReadyTick` 显示剩余 tick，冷却结束清空；冷却仍为 12 tick。
- 2026-09-30：`EnderSword.js` Q 技能增加 12 tick 冷却，冷却按玩家 UUID 维护，冷却期间拦截 Q 不生成弹射物并 actionbar 提示剩余 tick；实测连续 Q 只生成 1 颗、等待 15 tick 后可再次生成。
- 2026-09-30：新增 `EnderSword.js`「末影剑」——铁剑魔改、基础伤害 9、无限耐久、触及 +1.5（实体/方块交互距离）、有附魔光效但无法附魔；Q 拦截丢剑并投掷 2.5 倍速度（3.75 格/tick）的末影珍珠。实测物品属性与合成 `PlayerDropItemEvent` 的弹射物速度。
- 2026-09-30：新增 `BasicShield.js`「基础盾牌」——副手 +10 最大生命、无限耐久、无法附魔但强制附魔光效、固有 20% 减伤、格挡时获得 7 tick 无敌窗口；装备框架补充 `shield -> offhand`、`weapon -> arms` 槽位别名，并在 6.11 记录槽位别名规则。
- 2026-09-29：升级 v1.5.4。新增 7.12 `Resurrection.js` 契约：命令方块专用 `/resurrection <秒数>`（1~600 秒），以执行位置为基准找同世界最近玩家，保存原模式/飞行状态后切换旁观者，私发“已经切换为旁观者模式，请尽快前往死亡地点”，每秒 actionbar + 10/5/3/2/1 秒 title 倒计时，结束后恢复原模式与飞行状态；支持重复触发刷新计时、玩家退出立即恢复、PDC `resurrection_prev_mode` 在服务器重启/脚本重载后兜底恢复。实测命令方块 `/resurrection 5` 在 XP 上完成切换与恢复。


- 2026-09-29：升级 v1.5.3。修复 BOSS 名在播报消息中重复：`createBossScoreboard` 的队伍 `ijf_<uuid>` 不再设置 `[炎狱焚风] ` 聊天前缀，改为 `team.setPrefix("")`；队伍仍保留 Husk / Slime UUID 用于统一识别，但原版 `/damage`、`/execute`、死亡消息等不再出现“[炎狱焚风] 炎狱焚风”的双重名称；同时把火种回归提示从“[炎狱焚风] 炎狱焚风恢复了”改为“[炎狱焚风] 恢复了”。实测队伍前缀为空、displayName 仍为炎狱焚风。


- 2026-09-29：升级 v1.5.2。炎狱焚风死亡自爆胜利曲：`startDeathSequence()` 切换 `UNICUBE!`（`3368128694`）；从实际开始播放 tick 起计时 1 分 17 秒（`77 × 20` tick），到时自动移除胜利曲并 `/music next` 切回 AllMusic 默认歌单；不加入无缝循环副本，已开始后被手动切走视为结束；期间召唤新 BOSS 时战斗 BGM 优先、胜利曲计时照常并在超时后清理。实测 22:38:58 开始、22:40:15 结束回默认歌单。同步更新 7.11 契约。


- 2026-09-29：升级 v1.5.1。新增 7.11 AllMusic 阶段 BGM 契约：`InfernoFoehn.js` 一阶段循环 `22636637`（霊知の太陽信仰 ～ Nuclear Fusion），半血 / 火种阶段循环 `1495879966`（Armageddon）；通过 AllMusic 类加载器反射 `PlayMusic.nowPlayMusic` / `playList` 维护无缝队列副本，预加载 `IMusicApi.getPlayUrl` 写入 `playerUrl` 以避免歌词接口阻塞，死亡 / 清理 / 异步卸载 / BOSS 区块未加载 / 周围 256 格无玩家时停止并清理 BGM 队列。AllMusic 版本升级需重新实测。

- 2026-09-29：新增 `EquipRegistry` 装备注册契约与 `/equip <槽位> [装备名]` 获取框架；新增 `VillageSword.js`「村好剑」：木剑攻击 6 / 攻速 2 / 无限耐久 / 无附魔；Q 白色剑气 16 格 4 点弹射物伤害、E 重击 15 点破盾并过热 30 tick、F 突刺 5 格沿途 8 点伤害冷却 20 tick；记录 E 键在 Paper 1.21.8 纯原版客户端无法触发的实测限制。
- 2026-09-29：新增 `SuperTNT.js`：`/supertnt [0.1~64 浮点]` 获取自定义爆炸威力的 TNT；物品 PDC 携带威力，`TNTPrimeEvent` 记录待绑定、`EntitySpawnEvent` + 主循环绑定到 `TNTPrimed`、`ExplosionPrimeEvent` 取消原版整数爆炸并调用 5 参数 `createExplosion`；实测小数威力 1.75 / 4 / 6.5 与同威力原版参照的破坏方块数量一致，并记录 `BlockExplodeEvent.getYield()` 在 Paper 1.21.8 返回 interaction 系数而非爆炸威力。
- 2026-09-28：连续冲撞修复：无差别模式下冲撞目标扩展为 256 格内 LivingEntity（按距离排序、上限 10）；选中目标即推进队列，贴脸/撞墙补接触伤害，避免卡在不可达目标。
- 2026-09-28：升级 v1.5.0。新增计分板生命契约：脚本怪物本体固定 20 HP，所有伤害事件拦截后只扣计分板，计分板归零再清空本体生命触发死亡流程；血条/阶段/回血读取计分板；困难模式动态 HP 不再受原版 1024 上限影响；该规则对后续所有脚本怪物强制。
- 2026-09-28：升级 v1.4.1。修复困难模式 2 人及以上有效生命 >1024 时 `setHealth` 异常导致的瞬死/20 HP 问题，改用吸收护盾承载溢出生命；困难模式烈焰棒显示名改为 `[炎狱焚风-困难模式]`，恢复召唤倒计时消息。
- 2026-09-28：升级 v1.4.0。炎狱焚风新增 `-hard` 困难模式契约：召唤消耗烈焰棒、困难模式工具提示、动态 HP/火种/火球雨、多目标大火球、连续冲撞、10 次硬直、15/10 护甲、全玩家吸附、凋零水晶、强化半血/死亡自爆、移动速度 ×1.25；玩家数 >10 按 10 计算。
- 2026-09-28：升级 v1.3.0。新增 `DouQuQu.js` 无差别攻击模式：`/douququ <名字|all|off|list>`、主世界 PDC 持久化、`isActive`/`markEntity`/`isActiveEntity` 共享 API、目标扩展为 `LivingEntity`；开启模式的 BOSS 可被普通生物/投射物/其他脚本 BOSS 伤害，脚本 BOSS 之间可互相攻击；配套质量门禁与禁止项；`InfernoFoehn.js`、`ThousandFacedWitch.js` 已接入。
- 2026-09-28：升级 v1.2.0。新增 Husk + 浮空 Slime(size 4) 混合碰撞箱契约、`slimeCarrier` / `objective` / `scoreKey` / `team` 状态 schema、计分板 `inferno_foehn_hp` 与 `ijf_` 队伍统一伤害规则、混合碰撞箱质量门禁与禁止项；Slime 强制 `Invisible=true` 隐藏自身模型；同步现有脚本合规情况；新增实体 Class 参数与 `damage(amount, null)` 两条 Nashorn 硬约束，并修复 `ThousandFacedWitch.js` 的召唤异常。
- 2026-09-28：升级 v1.1.0。新增大型火焰弹 12 tick 红色预警、冲撞 8 tick 黄色预警、`largeFireballWarning` / `fireSeed*` 状态 schema、`activeFireSeeds` schema、火种实体与阶段契约、DUST 粒子规则、BlockDisplay 中心对齐与自转修复规则、超级冲撞水晶发射时机、BOSS 血条 key 与清理契约；同步威力数值与质量门禁。
- 2026-09-28：创建契约 v1.0.0。确定 IIFE + strict、脚本结构、调度、投射物/爆炸、事件、schema、质量门禁与变更流程。
