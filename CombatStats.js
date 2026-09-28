/*
 * CombatStats.js — OpenJS 1.5.0
 *
 * 给 AnimatedScoreboard 提供以下 PlaceholderAPI 变量：
 *   %openjs_combatstats_deaths%        —— 当前玩家的原版死亡次数
 *   %openjs_combatstats_mobkills%      —— 当前玩家击杀的生物总数
 *   %openjs_combatstats_damage_dealt%  —— 当前玩家打出的总伤害（科学计数法，保留 3 位小数）
 *   %openjs_combatstats_damage_taken%  —— 当前玩家承受的总伤害（科学计数法，保留 3 位小数）
 *
 * 数据直接读取原版统计（Statistic.DEATHS / MOB_KILLS / DAMAGE_DEALT / DAMAGE_TAKEN）。
 * 原版统计由服务端持久化，重启后不会丢失，也不需要额外的计时任务。
 * 这样管理员、服主和普通玩家的数据都使用同一套规则。
 *
 * 说明：原版伤害统计以 0.1 HP 为单位存储，这里先换算成 HP（除以 10），
 *       再用科学计数法输出，例如 134500000 → "1.345e7"。
 */

var Statistic = Java.type("org.bukkit.Statistic");
var Player = Java.type("org.bukkit.entity.Player");

var placeholderApi = Services.get("PlaceholderApi");

// 把原版伤害统计值换算成 HP 并格式化为科学计数法（保留 3 位小数，去掉指数里的 + 号）。
function formatDamage(rawValue) {
    var hp = parseFloat(String(rawValue)) / 10.0;
    if (isNaN(hp) || !isFinite(hp)) {
        hp = 0;
    }
    return hp.toExponential(3).replace("e+", "e");
}

placeholderApi.registerPlaceholder("combatstats", {
    onRequest: function(player, params) {
        var key = (params || "").toLowerCase();

        // 伤害类占位符即使拿不到玩家也返回统一的 0 格式
        if (key === "damage_dealt" || key === "damage_taken") {
            if (!(player instanceof Player)) {
                return formatDamage(0);
            }
            if (key === "damage_dealt") {
                return formatDamage(player.getStatistic(Statistic.DAMAGE_DEALT));
            }
            return formatDamage(player.getStatistic(Statistic.DAMAGE_TAKEN));
        }

        if (!(player instanceof Player)) {
            return "0";
        }

        if (key === "deaths") {
            return String(player.getStatistic(Statistic.DEATHS));
        }
        if (key === "mobkills") {
            return String(player.getStatistic(Statistic.MOB_KILLS));
        }
        return "0";
    }
});

// /oj reload 或脚本卸载时注销占位符，避免重复注册。
task.bindToUnload(function() {
    placeholderApi.unregisterPlaceholder("combatstats");
});
