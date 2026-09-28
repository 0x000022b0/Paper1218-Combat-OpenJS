/*
 * KanKanSword.js —— OpenJS 1.5.0
 *
 * 效果：手持这把带附魔光效的下界合金剑命中任意实体时，
 *       向所有在线玩家发送“我砍砍砍”。
 *
 * 获取指令：/kankansword
 */

var Material = org.bukkit.Material;
var ItemStack = org.bukkit.inventory.ItemStack;
var ChatColor = org.bukkit.ChatColor;
var Enchantment = org.bukkit.enchantments.Enchantment;
var ItemFlag = org.bukkit.inventory.ItemFlag;
var PersistentDataType = org.bukkit.persistence.PersistentDataType;
var NamespacedKey = org.bukkit.NamespacedKey;
var Player = Java.type("org.bukkit.entity.Player");

var SWORD_KEY = new NamespacedKey(plugin, "kankan_sword");

function createKanKanSword() {
    var sword = new ItemStack(Material.NETHERITE_SWORD, 1);
    var meta = sword.getItemMeta();

    meta.setDisplayName(ChatColor.LIGHT_PURPLE + "我砍砍砍剑");
    meta.setLore(toJavaList([
        ChatColor.GRAY + "命中任意实体时，向所有玩家发送：",
        ChatColor.YELLOW + "我砍砍砍"
    ]));

    // 给剑添加附魔光效；用 HIDE_ENCHANTS 隐藏附魔文字，只保留光效。
    meta.addEnchant(Enchantment.UNBREAKING, 1, true);
    meta.addItemFlags(ItemFlag.HIDE_ENCHANTS);

    // 用 PDC 做唯一标记，避免影响普通下界合金剑。
    meta.getPersistentDataContainer().set(SWORD_KEY, PersistentDataType.STRING, "true");

    sword.setItemMeta(meta);
    return sword;
}

function sendKanKanToAllPlayers() {
    var players = org.bukkit.Bukkit.getOnlinePlayers();
    var iterator = players.iterator();
    while (iterator.hasNext()) {
        iterator.next().sendMessage("我砍砍砍");
    }
}

registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function(event) {
    // OpenJS 会把基类 EntityDamageEvent 也分发到子类监听器上，
    // 普通伤害事件没有 getDamager()，这里必须做兼容保护。
    var damager = null;
    try {
        damager = event.getDamager();
    } catch (e) {
        return;
    }
    if (damager == null) return;

    // 只处理玩家手持本剑造成的命中。
    if (!(damager instanceof Player)) {
        return;
    }

    var item = damager.getInventory().getItemInMainHand();
    if (item == null || item.getType() != Material.NETHERITE_SWORD) {
        return;
    }

    var meta = item.getItemMeta();
    if (meta == null || !meta.getPersistentDataContainer().has(SWORD_KEY, PersistentDataType.STRING)) {
        return;
    }

    sendKanKanToAllPlayers();
});

addCommand("kankansword", {
    onCommand: function(sender) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("该指令只能由玩家使用。");
            return;
        }

        sender.getInventory().addItem(createKanKanSword());
        sender.sendMessage(ChatColor.GREEN + "已获得：我砍砍砍剑");
    }
});
