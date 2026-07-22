#include "td_game.h"

#include <limits.h>
#include <string.h>

const char *const td_faction_names[TD_FACTION_COUNT] = {
    "Meridian", "Helix", "Orison", "Ashwake", "Pilgrim"
};

const char *const td_commodity_names[TD_COMMODITY_COUNT] = {
    "Food", "Ore", "Fuel", "Medicine"
};

static const uint16_t td_base_prices[TD_COMMODITY_COUNT] = {18, 42, 55, 88};

/* Q0.15 direction vectors at 11.25-degree intervals. */
static const int16_t td_directions[32][2] = {
    {32767, 0}, {32138, 6393}, {30273, 12539}, {27245, 18204},
    {23170, 23170}, {18204, 27245}, {12539, 30273}, {6393, 32138},
    {0, 32767}, {-6393, 32138}, {-12539, 30273}, {-18204, 27245},
    {-23170, 23170}, {-27245, 18204}, {-30273, 12539}, {-32138, 6393},
    {-32767, 0}, {-32138, -6393}, {-30273, -12539}, {-27245, -18204},
    {-23170, -23170}, {-18204, -27245}, {-12539, -30273}, {-6393, -32138},
    {0, -32767}, {6393, -32138}, {12539, -30273}, {18204, -27245},
    {23170, -23170}, {27245, -18204}, {30273, -12539}, {32138, -6393}
};

static uint64_t td_splitmix64(uint64_t value)
{
    value += UINT64_C(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

static void td_rng_seed(TdRng *rng, uint64_t seed, uint64_t stream)
{
    rng->state = 0;
    rng->increment = (stream << 1u) | 1u;
    (void)td_rng_next(rng);
    rng->state += seed;
    (void)td_rng_next(rng);
}

uint32_t td_rng_next(TdRng *rng)
{
    uint64_t old_state = rng->state;
    uint32_t xorshifted;
    uint32_t rotation;
    rng->state = old_state * UINT64_C(6364136223846793005) + rng->increment;
    xorshifted = (uint32_t)(((old_state >> 18u) ^ old_state) >> 27u);
    rotation = (uint32_t)(old_state >> 59u);
    return (xorshifted >> rotation) | (xorshifted << ((0u - rotation) & 31u));
}

TdFix td_fix_mul(TdFix a, TdFix b)
{
    return (TdFix)(((int64_t)a * (int64_t)b) >> 16);
}

static TdFix td_clamp_fix(TdFix value, TdFix low, TdFix high)
{
    if (value < low) return low;
    if (value > high) return high;
    return value;
}

static int32_t td_clamp_i32(int32_t value, int32_t low, int32_t high)
{
    if (value < low) return low;
    if (value > high) return high;
    return value;
}

static void td_event(TdGame *game, uint8_t event_id)
{
    game->last_event = event_id;
    game->event_serial += 1u;
}

static uint64_t td_distance_sq_units(TdVec2 a, TdVec2 b)
{
    int64_t dx = (int64_t)TD_FIX_TO_INT(a.x - b.x);
    int64_t dy = (int64_t)TD_FIX_TO_INT(a.y - b.y);
    return (uint64_t)(dx * dx + dy * dy);
}

static void td_accelerate(TdVec2 *velocity, uint8_t heading, TdFix magnitude)
{
    const int16_t *direction = td_directions[(heading >> 3u) & 31u];
    velocity->x += (TdFix)(((int64_t)magnitude * direction[0]) >> 15);
    velocity->y += (TdFix)(((int64_t)magnitude * direction[1]) >> 15);
}

static uint8_t td_heading_to(TdVec2 from, TdVec2 to)
{
    int64_t dx = (int64_t)(to.x - from.x);
    int64_t dy = (int64_t)(to.y - from.y);
    int64_t best_dot = INT64_MIN;
    uint8_t best = 0;
    uint8_t index;
    for (index = 0; index < 32; ++index) {
        int64_t dot = dx * td_directions[index][0] + dy * td_directions[index][1];
        if (dot > best_dot) {
            best_dot = dot;
            best = index;
        }
    }
    return (uint8_t)(best << 3u);
}

static void td_make_system_name(char output[16], uint32_t value)
{
    static const char *const first[] = {
        "Ar", "Bel", "Cy", "Dor", "Eid", "Far", "Gly", "Hel",
        "Iri", "Jun", "Kor", "Lys", "Mer", "Nor", "Ori", "Pyr"
    };
    static const char *const second[] = {
        "axis", "eon", "ara", "ion", "ora", "une", "esh", "yra",
        "eth", "ium", "os", "urn", "al", "is", "on", "ea"
    };
    const char *a = first[value & 15u];
    const char *b = second[(value >> 4u) & 15u];
    size_t cursor = 0;
    while (*a != '\0' && cursor < 15u) output[cursor++] = *a++;
    while (*b != '\0' && cursor < 15u) output[cursor++] = *b++;
    output[cursor] = '\0';
}

static void td_generate_system(TdSystem *system, uint64_t seed, uint8_t index)
{
    TdRng rng;
    uint8_t commodity;
    uint32_t identity = (uint32_t)td_splitmix64(seed ^ (uint64_t)(index + 1u));
    memset(system, 0, sizeof(*system));
    system->identity = identity;
    td_make_system_name(system->name, identity);
    td_rng_seed(&rng, td_splitmix64(seed + index), UINT64_C(0x574f524c44) + index);
    system->station.x = TD_FIX_FROM_INT((int32_t)(td_rng_next(&rng) % 201u) - 100);
    system->station.y = TD_FIX_FROM_INT((int32_t)(td_rng_next(&rng) % 201u) - 100);
    system->gate.x = TD_FIX_FROM_INT(620 + (int32_t)(td_rng_next(&rng) % 181u));
    system->gate.y = TD_FIX_FROM_INT((int32_t)(td_rng_next(&rng) % 501u) - 250);
    system->market.faction = (uint8_t)(index % 3u);
    system->market.security = (uint8_t)(45u + td_rng_next(&rng) % 46u);
    for (commodity = 0; commodity < TD_COMMODITY_COUNT; ++commodity) {
        int32_t production = (int32_t)(td_rng_next(&rng) % 5u) - 2;
        if (commodity == (uint8_t)(index % TD_COMMODITY_COUNT)) production = 3;
        system->market.target[commodity] = (uint16_t)(52u + td_rng_next(&rng) % 29u);
        system->market.inventory[commodity] =
            (uint16_t)(30u + td_rng_next(&rng) % 71u);
        system->market.production[commodity] = (int8_t)production;
    }
    system->music.root_note = (uint8_t)(36u + identity % 12u);
    system->music.scale_id = (uint8_t)((identity >> 4u) % 3u);
    system->music.tempo = (uint8_t)(100u + (identity >> 8u) % 41u);
    system->music.groove = (uint8_t)((identity >> 16u) % 3u);
    system->music.instrument_set = (uint8_t)((identity >> 20u) % 3u);
    system->music.motif_seed = (uint8_t)(identity >> 24u);
}

static void td_spawn_enemy(TdGame *game)
{
    TdEnemy *enemy = &game->enemies[0];
    uint32_t angle_index;
    memset(game->enemies, 0, sizeof(game->enemies));
    angle_index = td_rng_next(&game->combat_rng) & 31u;
    enemy->active = 1;
    enemy->faction = TD_FACTION_ASHWAKE;
    enemy->heading = (uint8_t)(angle_index << 3u);
    enemy->position.x = game->player.position.x +
        (TdFix)((int64_t)td_directions[angle_index][0] * TD_FIX_FROM_INT(430) >> 15);
    enemy->position.y = game->player.position.y +
        (TdFix)((int64_t)td_directions[angle_index][1] * TD_FIX_FROM_INT(430) >> 15);
    enemy->hull = 70;
    enemy->shield = 30;
    enemy->fire_cooldown = 90;
    enemy->identity = (uint16_t)(td_rng_next(&game->combat_rng) & 0xffffu);
}

void td_game_init(TdGame *game, uint64_t universe_seed)
{
    uint8_t index;
    if (universe_seed == 0) universe_seed = UINT64_C(0x5445524e41525931);
    memset(game, 0, sizeof(*game));
    game->universe_seed = universe_seed;
    td_rng_seed(&game->economy_rng, td_splitmix64(universe_seed), UINT64_C(0x45434f4e));
    td_rng_seed(&game->mission_rng, td_splitmix64(universe_seed ^ 1u), UINT64_C(0x4d495353));
    td_rng_seed(&game->combat_rng, td_splitmix64(universe_seed ^ 2u), UINT64_C(0x434f4d42));
    for (index = 0; index < TD_SYSTEM_COUNT; ++index) {
        td_generate_system(&game->systems[index], universe_seed, index);
    }
    game->player.position.x = game->systems[0].station.x + TD_FIX_FROM_INT(90);
    game->player.position.y = game->systems[0].station.y;
    game->player.heading = 0;
    game->player.system = 0;
    game->player.hull = game->player.hull_max = 100;
    game->player.shield = game->player.shield_max = 60;
    game->player.energy = game->player.energy_max = 100;
    game->player.credits = 750;
    game->player.cargo_capacity = 12;
    for (index = 0; index < TD_FACTION_COUNT; ++index) {
        game->player.reputation[index] = 0;
    }
    game->selected_commodity = 0;
    game->upgrade_cursor = 0;
    td_spawn_enemy(game);
}

uint8_t td_player_cargo_used(const TdPlayer *player)
{
    uint16_t used = 0;
    uint8_t index;
    for (index = 0; index < TD_COMMODITY_COUNT; ++index) used += player->cargo[index];
    return used > 255u ? 255u : (uint8_t)used;
}

int td_near_station(const TdGame *game)
{
    const TdSystem *system = &game->systems[game->player.system];
    return td_distance_sq_units(game->player.position, system->station) <= UINT64_C(58) * 58u;
}

int td_near_gate(const TdGame *game)
{
    const TdSystem *system = &game->systems[game->player.system];
    return td_distance_sq_units(game->player.position, system->gate) <= UINT64_C(72) * 72u;
}

uint16_t td_market_price(const TdGame *game, uint8_t system_index,
                         uint8_t commodity_index, int buying)
{
    const TdSystem *system;
    int32_t base;
    int32_t target;
    int32_t inventory;
    int32_t price;
    int32_t reputation;
    if (system_index >= TD_SYSTEM_COUNT || commodity_index >= TD_COMMODITY_COUNT) return 0;
    system = &game->systems[system_index];
    base = td_base_prices[commodity_index];
    target = system->market.target[commodity_index];
    inventory = system->market.inventory[commodity_index];
    price = base + (base * (target - inventory)) / (target > 0 ? target : 1);
    price = td_clamp_i32(price, base / 3, base * 4);
    reputation = game->player.reputation[system->market.faction];
    price -= (price * td_clamp_i32(reputation, -500, 500)) / 5000;
    price += buying ? 2 : -2;
    return (uint16_t)td_clamp_i32(price, 1, 999);
}

static void td_market_update(TdGame *game)
{
    uint8_t system_index;
    uint8_t commodity;
    for (system_index = 0; system_index < TD_SYSTEM_COUNT; ++system_index) {
        TdMarket *market = &game->systems[system_index].market;
        for (commodity = 0; commodity < TD_COMMODITY_COUNT; ++commodity) {
            int32_t jitter = (int32_t)(td_rng_next(&game->economy_rng) % 3u) - 1;
            int32_t next = (int32_t)market->inventory[commodity] +
                market->production[commodity] + jitter;
            market->inventory[commodity] = (uint16_t)td_clamp_i32(next, 0, 255);
        }
    }
}

static void td_complete_mission(TdGame *game)
{
    uint8_t faction = game->systems[game->player.system].market.faction;
    game->player.credits += game->mission.reward;
    game->player.reputation[faction] = (int16_t)td_clamp_i32(
        game->player.reputation[faction] + 65, -1000, 1000);
    memset(&game->mission, 0, sizeof(game->mission));
    td_event(game, TD_EVENT_MISSION_COMPLETED);
}

static void td_check_delivery(TdGame *game)
{
    TdMission *mission = &game->mission;
    if (!mission->active || mission->type != TD_MISSION_DELIVER) return;
    if (game->player.system != mission->destination_system) return;
    if (game->player.cargo[mission->commodity] < mission->quantity) return;
    game->player.cargo[mission->commodity] -= mission->quantity;
    td_complete_mission(game);
}

static void td_generate_mission(TdGame *game)
{
    TdMission *mission = &game->mission;
    uint32_t roll;
    if (mission->active) return;
    roll = td_rng_next(&game->mission_rng);
    memset(mission, 0, sizeof(*mission));
    mission->active = 1;
    mission->origin_system = game->player.system;
    mission->destination_system = (uint8_t)((game->player.system + 1u + (roll & 1u)) % TD_SYSTEM_COUNT);
    mission->expiry_tick = game->tick + TD_TICK_HZ * 60u * 8u;
    if ((roll & 2u) == 0u) {
        mission->type = TD_MISSION_DELIVER;
        mission->commodity = (uint8_t)((roll >> 8u) % TD_COMMODITY_COUNT);
        mission->quantity = (uint8_t)(3u + ((roll >> 12u) % 4u));
        mission->reward = 260u + mission->quantity * 55u;
    } else {
        mission->type = TD_MISSION_BOUNTY;
        mission->target_faction = TD_FACTION_ASHWAKE;
        mission->reward = 480u + (roll % 180u);
    }
    td_event(game, TD_EVENT_MISSION_ACCEPTED);
}

static void td_buy(TdGame *game)
{
    TdMarket *market = &game->systems[game->player.system].market;
    uint8_t commodity = game->selected_commodity;
    uint16_t price = td_market_price(game, game->player.system, commodity, 1);
    if (td_player_cargo_used(&game->player) >= game->player.cargo_capacity) {
        td_event(game, TD_EVENT_CARGO_FULL);
        return;
    }
    if (market->inventory[commodity] == 0) return;
    if (game->player.credits < price) {
        td_event(game, TD_EVENT_NO_CREDITS);
        return;
    }
    game->player.credits -= price;
    game->player.cargo[commodity] += 1u;
    market->inventory[commodity] = (uint16_t)(market->inventory[commodity] - 1u);
    td_event(game, TD_EVENT_TRADE);
}

static void td_sell(TdGame *game)
{
    TdMarket *market = &game->systems[game->player.system].market;
    uint8_t commodity = game->selected_commodity;
    uint16_t price = td_market_price(game, game->player.system, commodity, 0);
    if (game->player.cargo[commodity] == 0) return;
    game->player.cargo[commodity] = (uint8_t)(game->player.cargo[commodity] - 1u);
    if (market->inventory[commodity] < 255u) market->inventory[commodity] += 1u;
    game->player.credits += price;
    td_event(game, TD_EVENT_TRADE);
}

static void td_upgrade(TdGame *game)
{
    uint8_t *level;
    uint32_t cost;
    if (game->upgrade_cursor == 0) level = &game->player.engine_level;
    else if (game->upgrade_cursor == 1) level = &game->player.weapon_level;
    else level = &game->player.shield_level;
    if (*level >= 3u) {
        game->upgrade_cursor = (uint8_t)((game->upgrade_cursor + 1u) % 3u);
        return;
    }
    cost = 380u + (uint32_t)(*level) * 420u;
    if (game->player.credits < cost) {
        td_event(game, TD_EVENT_NO_CREDITS);
        return;
    }
    game->player.credits -= cost;
    *level += 1u;
    if (game->upgrade_cursor == 0) game->player.cargo_capacity += 2u;
    if (game->upgrade_cursor == 2) {
        game->player.shield_max = (uint16_t)(game->player.shield_max + 20u);
        game->player.shield = game->player.shield_max;
    }
    game->upgrade_cursor = (uint8_t)((game->upgrade_cursor + 1u) % 3u);
    td_event(game, TD_EVENT_UPGRADED);
}

static void td_repair(TdGame *game)
{
    uint32_t missing = (uint32_t)(game->player.hull_max - game->player.hull);
    uint32_t cost = missing * 2u;
    if (missing == 0) return;
    if (game->player.credits < cost) {
        td_event(game, TD_EVENT_NO_CREDITS);
        return;
    }
    game->player.credits -= cost;
    game->player.hull = game->player.hull_max;
    game->player.shield = game->player.shield_max;
    td_event(game, TD_EVENT_REPAIRED);
}

static void td_step_docked(TdGame *game, uint32_t pressed)
{
    if (pressed & TD_INPUT_SELECT_PREV) {
        game->selected_commodity = (uint8_t)((game->selected_commodity + TD_COMMODITY_COUNT - 1u) % TD_COMMODITY_COUNT);
    }
    if (pressed & TD_INPUT_SELECT_NEXT) {
        game->selected_commodity = (uint8_t)((game->selected_commodity + 1u) % TD_COMMODITY_COUNT);
    }
    if (pressed & TD_INPUT_BUY) td_buy(game);
    if (pressed & TD_INPUT_SELL) td_sell(game);
    if (pressed & TD_INPUT_MISSION) td_generate_mission(game);
    if (pressed & TD_INPUT_UPGRADE) td_upgrade(game);
    if (pressed & TD_INPUT_REPAIR) td_repair(game);
    td_check_delivery(game);
    if (pressed & TD_INPUT_LAUNCH) {
        const TdSystem *system = &game->systems[game->player.system];
        game->player.docked = 0;
        game->player.position.x = system->station.x + TD_FIX_FROM_INT(72);
        game->player.position.y = system->station.y;
        game->player.velocity.x = 0;
        game->player.velocity.y = 0;
        td_event(game, TD_EVENT_LAUNCHED);
    }
}

static void td_spawn_projectile(TdGame *game, TdVec2 position, TdVec2 inherited_velocity,
                                uint8_t heading, uint8_t hostile, uint8_t damage)
{
    uint8_t index;
    for (index = 0; index < TD_MAX_PROJECTILES; ++index) {
        TdProjectile *projectile = &game->projectiles[index];
        if (!projectile->active) {
            memset(projectile, 0, sizeof(*projectile));
            projectile->active = 1;
            projectile->hostile = hostile;
            projectile->damage = damage;
            projectile->position = position;
            projectile->velocity = inherited_velocity;
            td_accelerate(&projectile->velocity, heading, TD_FIX_FROM_INT(13));
            projectile->lifetime = 100;
            projectile->identity = (uint16_t)(game->event_serial++ & 0xffffu);
            return;
        }
    }
}

static void td_apply_damage(uint16_t *shield, uint16_t *hull, uint8_t damage)
{
    uint16_t remaining = damage;
    if (*shield >= remaining) {
        *shield = (uint16_t)(*shield - remaining);
        return;
    }
    remaining = (uint16_t)(remaining - *shield);
    *shield = 0;
    *hull = *hull > remaining ? (uint16_t)(*hull - remaining) : 0;
}

static void td_drop_salvage(TdGame *game, TdVec2 position)
{
    uint8_t index;
    for (index = 0; index < TD_MAX_SALVAGE; ++index) {
        TdSalvage *salvage = &game->salvage[index];
        if (!salvage->active) {
            salvage->active = 1;
            salvage->position = position;
            salvage->commodity = (uint8_t)(td_rng_next(&game->combat_rng) % TD_COMMODITY_COUNT);
            salvage->quantity = (uint8_t)(1u + td_rng_next(&game->combat_rng) % 3u);
            salvage->identity = (uint16_t)(td_rng_next(&game->combat_rng) & 0xffffu);
            return;
        }
    }
}

static void td_enemy_destroyed(TdGame *game, TdEnemy *enemy)
{
    TdVec2 position = enemy->position;
    enemy->active = 0;
    game->enemy_respawn_ticks = TD_TICK_HZ * 18u;
    td_drop_salvage(game, position);
    game->player.reputation[TD_FACTION_ASHWAKE] = (int16_t)td_clamp_i32(
        game->player.reputation[TD_FACTION_ASHWAKE] - 35, -1000, 1000);
    game->player.reputation[TD_FACTION_HELIX] = (int16_t)td_clamp_i32(
        game->player.reputation[TD_FACTION_HELIX] + 20, -1000, 1000);
    if (game->mission.active && game->mission.type == TD_MISSION_BOUNTY &&
        game->player.system == game->mission.destination_system) {
        td_complete_mission(game);
    } else {
        td_event(game, TD_EVENT_ENEMY_DESTROYED);
    }
}

static void td_collect_or_dock(TdGame *game)
{
    uint8_t index;
    for (index = 0; index < TD_MAX_SALVAGE; ++index) {
        TdSalvage *salvage = &game->salvage[index];
        if (salvage->active && td_distance_sq_units(game->player.position, salvage->position) <= 42u * 42u) {
            uint8_t room = (uint8_t)(game->player.cargo_capacity - td_player_cargo_used(&game->player));
            uint8_t taken = salvage->quantity < room ? salvage->quantity : room;
            if (taken == 0) {
                td_event(game, TD_EVENT_CARGO_FULL);
                return;
            }
            game->player.cargo[salvage->commodity] += taken;
            salvage->quantity -= taken;
            if (salvage->quantity == 0) salvage->active = 0;
            td_event(game, TD_EVENT_SALVAGED);
            return;
        }
    }
    if (td_near_station(game)) {
        game->player.docked = 1;
        game->player.velocity.x = 0;
        game->player.velocity.y = 0;
        td_event(game, TD_EVENT_DOCKED);
        td_check_delivery(game);
    }
}

static void td_jump(TdGame *game)
{
    uint8_t destination;
    const TdSystem *system;
    if (!td_near_gate(game)) return;
    destination = (uint8_t)((game->player.system + 1u) % TD_SYSTEM_COUNT);
    game->player.system = destination;
    system = &game->systems[destination];
    game->player.position.x = system->gate.x - TD_FIX_FROM_INT(95);
    game->player.position.y = system->gate.y;
    game->player.velocity.x = 0;
    game->player.velocity.y = 0;
    memset(game->projectiles, 0, sizeof(game->projectiles));
    memset(game->salvage, 0, sizeof(game->salvage));
    game->enemy_respawn_ticks = 0;
    td_spawn_enemy(game);
    td_event(game, TD_EVENT_JUMPED);
}

static void td_step_player(TdGame *game, uint32_t input, uint32_t pressed)
{
    TdPlayer *player = &game->player;
    TdFix thrust = TD_FIX_FROM_INT(1) / 18;
    TdFix maximum_speed;
    if (pressed & TD_INPUT_ENGINE_KILL) player->engine_kill = (uint8_t)!player->engine_kill;
    if (input & TD_INPUT_TURN_LEFT) player->heading = (uint8_t)(player->heading - 3u);
    if (input & TD_INPUT_TURN_RIGHT) player->heading = (uint8_t)(player->heading + 3u);
    if (input & TD_INPUT_THRUST) td_accelerate(&player->velocity, player->heading, thrust + player->engine_level * (thrust / 5));
    if (input & TD_INPUT_REVERSE) td_accelerate(&player->velocity, (uint8_t)(player->heading + 128u), thrust / 2);
    if (input & TD_INPUT_STRAFE_LEFT) td_accelerate(&player->velocity, (uint8_t)(player->heading - 64u), thrust / 2);
    if (input & TD_INPUT_STRAFE_RIGHT) td_accelerate(&player->velocity, (uint8_t)(player->heading + 64u), thrust / 2);
    if (!player->engine_kill) {
        player->velocity.x = td_fix_mul(player->velocity.x, 64880);
        player->velocity.y = td_fix_mul(player->velocity.y, 64880);
    }
    maximum_speed = TD_FIX_FROM_INT((input & TD_INPUT_CRUISE) ? 9 : 5) +
        TD_FIX_FROM_INT(player->engine_level);
    player->velocity.x = td_clamp_fix(player->velocity.x, -maximum_speed, maximum_speed);
    player->velocity.y = td_clamp_fix(player->velocity.y, -maximum_speed, maximum_speed);
    player->position.x += player->velocity.x;
    player->position.y += player->velocity.y;
    player->position.x = td_clamp_fix(player->position.x, TD_FIX_FROM_INT(-1100), TD_FIX_FROM_INT(1100));
    player->position.y = td_clamp_fix(player->position.y, TD_FIX_FROM_INT(-800), TD_FIX_FROM_INT(800));
    if (player->fire_cooldown > 0) player->fire_cooldown = (uint16_t)(player->fire_cooldown - 1u);
    if (player->energy < player->energy_max && (game->tick & 1u) == 0u) player->energy += 1u;
    if ((input & TD_INPUT_FIRE) && player->fire_cooldown == 0 && player->energy >= 5u) {
        td_spawn_projectile(game, player->position, player->velocity, player->heading, 0,
                            (uint8_t)(12u + player->weapon_level * 5u));
        player->energy = (uint16_t)(player->energy - 5u);
        player->fire_cooldown = (uint16_t)(11u - player->weapon_level * 2u);
    }
    if (pressed & TD_INPUT_INTERACT) td_collect_or_dock(game);
    if (pressed & TD_INPUT_JUMP) td_jump(game);
}

static void td_step_enemy(TdGame *game, TdEnemy *enemy)
{
    uint64_t distance_sq;
    uint8_t desired;
    int16_t turn_delta;
    if (!enemy->active) return;
    distance_sq = td_distance_sq_units(enemy->position, game->player.position);
    desired = td_heading_to(enemy->position, game->player.position);
    turn_delta = (int16_t)(uint8_t)(desired - enemy->heading);
    if (turn_delta > 127) turn_delta -= 256;
    if (turn_delta > 0) enemy->heading = (uint8_t)(enemy->heading + 2u);
    else if (turn_delta < 0) enemy->heading = (uint8_t)(enemy->heading - 2u);
    if (distance_sq > 145u * 145u) td_accelerate(&enemy->velocity, enemy->heading, TD_FIX_FROM_INT(1) / 25);
    if (distance_sq < 90u * 90u) td_accelerate(&enemy->velocity, (uint8_t)(enemy->heading + 128u), TD_FIX_FROM_INT(1) / 35);
    enemy->velocity.x = td_fix_mul(enemy->velocity.x, 65020);
    enemy->velocity.y = td_fix_mul(enemy->velocity.y, 65020);
    enemy->position.x += enemy->velocity.x;
    enemy->position.y += enemy->velocity.y;
    if (enemy->fire_cooldown > 0) enemy->fire_cooldown = (uint16_t)(enemy->fire_cooldown - 1u);
    if (!game->player.docked && distance_sq < 390u * 390u && enemy->fire_cooldown == 0) {
        td_spawn_projectile(game, enemy->position, enemy->velocity, desired, 1, 8);
        enemy->fire_cooldown = (uint16_t)(42u + (enemy->identity & 15u));
    }
}

static void td_step_projectiles(TdGame *game)
{
    uint8_t projectile_index;
    for (projectile_index = 0; projectile_index < TD_MAX_PROJECTILES; ++projectile_index) {
        TdProjectile *projectile = &game->projectiles[projectile_index];
        uint8_t enemy_index;
        if (!projectile->active) continue;
        projectile->position.x += projectile->velocity.x;
        projectile->position.y += projectile->velocity.y;
        if (projectile->lifetime > 0) projectile->lifetime = (uint16_t)(projectile->lifetime - 1u);
        if (projectile->lifetime == 0) {
            projectile->active = 0;
            continue;
        }
        if (projectile->hostile) {
            if (!game->player.docked && td_distance_sq_units(projectile->position, game->player.position) <= 14u * 14u) {
                td_apply_damage(&game->player.shield, &game->player.hull, projectile->damage);
                projectile->active = 0;
            }
            continue;
        }
        for (enemy_index = 0; enemy_index < TD_MAX_ENEMIES; ++enemy_index) {
            TdEnemy *enemy = &game->enemies[enemy_index];
            if (enemy->active && td_distance_sq_units(projectile->position, enemy->position) <= 16u * 16u) {
                td_apply_damage(&enemy->shield, &enemy->hull, projectile->damage);
                projectile->active = 0;
                if (enemy->hull == 0) td_enemy_destroyed(game, enemy);
                break;
            }
        }
    }
}

static void td_player_destroyed(TdGame *game)
{
    TdSystem *system = &game->systems[game->player.system];
    game->player.credits = game->player.credits > 150u ? game->player.credits - 150u : 0u;
    game->player.hull = game->player.hull_max;
    game->player.shield = game->player.shield_max;
    game->player.energy = game->player.energy_max;
    game->player.position = system->station;
    game->player.velocity.x = 0;
    game->player.velocity.y = 0;
    game->player.docked = 1;
    memset(game->projectiles, 0, sizeof(game->projectiles));
    td_event(game, TD_EVENT_PLAYER_DESTROYED);
}

static void td_update_qutrits(TdGame *game)
{
    const TdSystem *system = &game->systems[game->player.system];
    uint32_t inventory = 0;
    uint32_t target = 0;
    uint64_t nearest = UINT64_MAX;
    int32_t reputation = game->player.reputation[system->market.faction];
    uint8_t index;
    for (index = 0; index < TD_MAX_ENEMIES; ++index) {
        if (game->enemies[index].active) {
            uint64_t distance = td_distance_sq_units(game->player.position, game->enemies[index].position);
            if (distance < nearest) nearest = distance;
        }
    }
    game->music_qutrits.threat = nearest < 260u * 260u ? 2u : (nearest != UINT64_MAX ? 1u : 0u);
    game->music_qutrits.navigation = (uint8_t)(game->player.docked ? 0u :
        (nearest < 260u * 260u ? 2u :
        ((td_near_station(game) || td_near_gate(game)) ? 1u : 0u)));
    for (index = 0; index < TD_COMMODITY_COUNT; ++index) {
        inventory += system->market.inventory[index];
        target += system->market.target[index];
    }
    game->music_qutrits.economy = inventory * 10u < target * 8u ? 2u :
        (uint8_t)(inventory * 10u > target * 11u ? 0u : 1u);
    game->music_qutrits.faction = reputation < -250 ? 2u : (uint8_t)(reputation > 250 ? 0u : 1u);
    game->music_qutrits.hull = game->player.hull * 4u < game->player.hull_max ? 2u :
        (uint8_t)(game->player.hull * 3u < game->player.hull_max * 2u ? 1u : 0u);
}

void td_game_step(TdGame *game, uint32_t input)
{
    uint32_t pressed = input & ~game->previous_input;
    uint8_t index;
    game->tick += 1u;
    game->market_ticks += 1u;
    if (game->market_ticks >= TD_TICK_HZ * 10u) {
        game->market_ticks = 0;
        td_market_update(game);
    }
    if (game->mission.active && game->tick >= game->mission.expiry_tick) {
        memset(&game->mission, 0, sizeof(game->mission));
    }
    if (game->player.docked) {
        td_step_docked(game, pressed);
    } else {
        td_step_player(game, input, pressed);
        for (index = 0; index < TD_MAX_ENEMIES; ++index) td_step_enemy(game, &game->enemies[index]);
        td_step_projectiles(game);
        if (game->player.hull == 0) td_player_destroyed(game);
    }
    if (!game->enemies[0].active && game->enemy_respawn_ticks > 0) {
        game->enemy_respawn_ticks -= 1u;
        if (game->enemy_respawn_ticks == 0) td_spawn_enemy(game);
    }
    if ((game->tick % 15u) == 0u) td_update_qutrits(game);
    game->previous_input = input;
}

static uint64_t td_hash_byte(uint64_t hash, uint8_t byte)
{
    return (hash ^ byte) * UINT64_C(1099511628211);
}

static uint64_t td_hash_u16(uint64_t hash, uint16_t value)
{
    hash = td_hash_byte(hash, (uint8_t)value);
    return td_hash_byte(hash, (uint8_t)(value >> 8u));
}

static uint64_t td_hash_u32(uint64_t hash, uint32_t value)
{
    hash = td_hash_u16(hash, (uint16_t)value);
    return td_hash_u16(hash, (uint16_t)(value >> 16u));
}

static uint64_t td_hash_u64(uint64_t hash, uint64_t value)
{
    hash = td_hash_u32(hash, (uint32_t)value);
    return td_hash_u32(hash, (uint32_t)(value >> 32u));
}

static uint64_t td_hash_vec(uint64_t hash, TdVec2 value)
{
    hash = td_hash_u32(hash, (uint32_t)value.x);
    return td_hash_u32(hash, (uint32_t)value.y);
}

uint64_t td_game_state_hash(const TdGame *game)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    uint8_t i;
    uint8_t j;
    hash = td_hash_u64(hash, game->universe_seed);
    hash = td_hash_u64(hash, game->tick);
    hash = td_hash_u64(hash, game->economy_rng.state);
    hash = td_hash_u64(hash, game->economy_rng.increment);
    hash = td_hash_u64(hash, game->mission_rng.state);
    hash = td_hash_u64(hash, game->mission_rng.increment);
    hash = td_hash_u64(hash, game->combat_rng.state);
    hash = td_hash_u64(hash, game->combat_rng.increment);
    for (i = 0; i < TD_SYSTEM_COUNT; ++i) {
        const TdSystem *system = &game->systems[i];
        for (j = 0; j < 16; ++j) hash = td_hash_byte(hash, (uint8_t)system->name[j]);
        hash = td_hash_u32(hash, system->identity);
        hash = td_hash_vec(hash, system->station);
        hash = td_hash_vec(hash, system->gate);
        for (j = 0; j < TD_COMMODITY_COUNT; ++j) {
            hash = td_hash_u16(hash, system->market.inventory[j]);
            hash = td_hash_u16(hash, system->market.target[j]);
            hash = td_hash_byte(hash, (uint8_t)system->market.production[j]);
        }
        hash = td_hash_byte(hash, system->market.security);
        hash = td_hash_byte(hash, system->market.faction);
        hash = td_hash_byte(hash, system->music.root_note);
        hash = td_hash_byte(hash, system->music.scale_id);
        hash = td_hash_byte(hash, system->music.tempo);
        hash = td_hash_byte(hash, system->music.groove);
        hash = td_hash_byte(hash, system->music.instrument_set);
        hash = td_hash_byte(hash, system->music.motif_seed);
    }
    hash = td_hash_vec(hash, game->player.position);
    hash = td_hash_vec(hash, game->player.velocity);
    hash = td_hash_byte(hash, game->player.heading);
    hash = td_hash_byte(hash, game->player.system);
    hash = td_hash_byte(hash, game->player.docked);
    hash = td_hash_byte(hash, game->player.engine_kill);
    hash = td_hash_u16(hash, game->player.hull);
    hash = td_hash_u16(hash, game->player.hull_max);
    hash = td_hash_u16(hash, game->player.shield);
    hash = td_hash_u16(hash, game->player.shield_max);
    hash = td_hash_u16(hash, game->player.energy);
    hash = td_hash_u16(hash, game->player.energy_max);
    hash = td_hash_u16(hash, game->player.heat);
    hash = td_hash_u16(hash, game->player.fire_cooldown);
    hash = td_hash_u32(hash, game->player.credits);
    for (i = 0; i < TD_COMMODITY_COUNT; ++i) hash = td_hash_byte(hash, game->player.cargo[i]);
    hash = td_hash_byte(hash, game->player.cargo_capacity);
    hash = td_hash_byte(hash, game->player.engine_level);
    hash = td_hash_byte(hash, game->player.weapon_level);
    hash = td_hash_byte(hash, game->player.shield_level);
    for (i = 0; i < TD_FACTION_COUNT; ++i) hash = td_hash_u16(hash, (uint16_t)game->player.reputation[i]);
    for (i = 0; i < TD_MAX_ENEMIES; ++i) {
        const TdEnemy *enemy = &game->enemies[i];
        hash = td_hash_byte(hash, enemy->active);
        hash = td_hash_byte(hash, enemy->faction);
        hash = td_hash_byte(hash, enemy->heading);
        hash = td_hash_byte(hash, enemy->ai_phase);
        hash = td_hash_vec(hash, enemy->position);
        hash = td_hash_vec(hash, enemy->velocity);
        hash = td_hash_u16(hash, enemy->hull);
        hash = td_hash_u16(hash, enemy->shield);
        hash = td_hash_u16(hash, enemy->fire_cooldown);
        hash = td_hash_u16(hash, enemy->identity);
    }
    for (i = 0; i < TD_MAX_PROJECTILES; ++i) {
        const TdProjectile *projectile = &game->projectiles[i];
        hash = td_hash_byte(hash, projectile->active);
        hash = td_hash_byte(hash, projectile->hostile);
        hash = td_hash_byte(hash, projectile->damage);
        hash = td_hash_vec(hash, projectile->position);
        hash = td_hash_vec(hash, projectile->velocity);
        hash = td_hash_u16(hash, projectile->lifetime);
        hash = td_hash_u16(hash, projectile->identity);
    }
    for (i = 0; i < TD_MAX_SALVAGE; ++i) {
        const TdSalvage *salvage = &game->salvage[i];
        hash = td_hash_byte(hash, salvage->active);
        hash = td_hash_byte(hash, salvage->commodity);
        hash = td_hash_byte(hash, salvage->quantity);
        hash = td_hash_vec(hash, salvage->position);
        hash = td_hash_u16(hash, salvage->identity);
    }
    hash = td_hash_byte(hash, game->mission.type);
    hash = td_hash_byte(hash, game->mission.active);
    hash = td_hash_byte(hash, game->mission.origin_system);
    hash = td_hash_byte(hash, game->mission.destination_system);
    hash = td_hash_byte(hash, game->mission.commodity);
    hash = td_hash_byte(hash, game->mission.quantity);
    hash = td_hash_byte(hash, game->mission.target_faction);
    hash = td_hash_u32(hash, game->mission.reward);
    hash = td_hash_u64(hash, game->mission.expiry_tick);
    hash = td_hash_byte(hash, game->music_qutrits.navigation);
    hash = td_hash_byte(hash, game->music_qutrits.threat);
    hash = td_hash_byte(hash, game->music_qutrits.economy);
    hash = td_hash_byte(hash, game->music_qutrits.faction);
    hash = td_hash_byte(hash, game->music_qutrits.hull);
    hash = td_hash_u32(hash, game->previous_input);
    hash = td_hash_u32(hash, game->event_serial);
    hash = td_hash_u32(hash, game->enemy_respawn_ticks);
    hash = td_hash_u16(hash, game->market_ticks);
    hash = td_hash_byte(hash, game->selected_commodity);
    hash = td_hash_byte(hash, game->upgrade_cursor);
    hash = td_hash_byte(hash, game->last_event);
    return hash;
}

void td_save_make(TdSaveImage *image, const TdGame *game)
{
    uint64_t hash;
    memset(image, 0, sizeof(*image));
    image->magic = TD_SAVE_MAGIC;
    image->version = TD_VERSION;
    image->game_size = (uint32_t)sizeof(TdGame);
    image->game = *game;
    hash = td_game_state_hash(game);
    image->state_hash = hash;
    image->checksum = image->magic ^ image->version ^ image->game_size ^
        (uint32_t)hash ^ (uint32_t)(hash >> 32u);
}

int td_save_restore(TdGame *game, const TdSaveImage *image)
{
    uint32_t checksum;
    uint64_t hash;
    if (image->magic != TD_SAVE_MAGIC || image->version != TD_VERSION ||
        image->game_size != sizeof(TdGame)) return 0;
    checksum = image->magic ^ image->version ^ image->game_size ^
        (uint32_t)image->state_hash ^ (uint32_t)(image->state_hash >> 32u);
    if (checksum != image->checksum) return 0;
    hash = td_game_state_hash(&image->game);
    if (hash != image->state_hash) return 0;
    *game = image->game;
    return 1;
}

static uint32_t td_hash32_byte(uint32_t hash, uint8_t byte)
{
    return (hash ^ byte) * UINT32_C(16777619);
}

static uint32_t td_hash32_u32(uint32_t hash, uint32_t value)
{
    hash = td_hash32_byte(hash, (uint8_t)value);
    hash = td_hash32_byte(hash, (uint8_t)(value >> 8u));
    hash = td_hash32_byte(hash, (uint8_t)(value >> 16u));
    return td_hash32_byte(hash, (uint8_t)(value >> 24u));
}

static uint32_t td_hash32_u64(uint32_t hash, uint64_t value)
{
    hash = td_hash32_u32(hash, (uint32_t)value);
    return td_hash32_u32(hash, (uint32_t)(value >> 32u));
}

uint32_t td_replay_checksum(const TdReplay *replay)
{
    uint32_t hash = UINT32_C(2166136261);
    uint32_t index;
    hash = td_hash32_u32(hash, replay->magic);
    hash = td_hash32_u32(hash, replay->version);
    hash = td_hash32_u64(hash, replay->universe_seed);
    hash = td_hash32_u64(hash, replay->initial_hash);
    hash = td_hash32_u64(hash, replay->final_hash);
    hash = td_hash32_u64(hash, replay->final_tick);
    hash = td_hash32_u32(hash, replay->event_count);
    for (index = 0; index < replay->event_count && index < TD_REPLAY_MAX_EVENTS; ++index) {
        hash = td_hash32_u32(hash, replay->events[index].tick_delta);
        hash = td_hash32_u32(hash, replay->events[index].buttons);
    }
    return hash;
}

void td_replay_record_begin(TdReplay *replay, const TdGame *game)
{
    memset(replay, 0, sizeof(*replay));
    replay->magic = TD_REPLAY_MAGIC;
    replay->version = TD_VERSION;
    replay->universe_seed = game->universe_seed;
    replay->initial_hash = td_game_state_hash(game);
}

int td_replay_record_input(TdReplay *replay, uint64_t tick, uint32_t buttons)
{
    TdReplayEvent *event;
    uint64_t delta;
    if (buttons == replay->last_buttons) return 1;
    if (replay->event_count >= TD_REPLAY_MAX_EVENTS) return 0;
    delta = tick - replay->last_event_tick;
    if (delta > UINT32_MAX) return 0;
    event = &replay->events[replay->event_count++];
    event->tick_delta = (uint32_t)delta;
    event->buttons = buttons;
    replay->last_buttons = buttons;
    replay->last_event_tick = tick;
    return 1;
}

void td_replay_record_finish(TdReplay *replay, const TdGame *game)
{
    replay->final_tick = game->tick;
    replay->final_hash = td_game_state_hash(game);
    replay->checksum = td_replay_checksum(replay);
}

int td_replay_play_begin(TdReplay *replay, TdGame *game)
{
    if (replay->magic != TD_REPLAY_MAGIC || replay->version != TD_VERSION ||
        replay->event_count > TD_REPLAY_MAX_EVENTS ||
        replay->checksum != td_replay_checksum(replay)) return 0;
    td_game_init(game, replay->universe_seed);
    if (td_game_state_hash(game) != replay->initial_hash) return 0;
    replay->playback_index = 0;
    replay->playback_buttons = 0;
    replay->playback_next_tick = replay->event_count > 0 ? replay->events[0].tick_delta : UINT64_MAX;
    return 1;
}

uint32_t td_replay_input_for_tick(TdReplay *replay, uint64_t tick)
{
    if (replay->playback_index < replay->event_count && tick == replay->playback_next_tick) {
        replay->playback_buttons = replay->events[replay->playback_index].buttons;
        replay->playback_index += 1u;
        if (replay->playback_index < replay->event_count) {
            replay->playback_next_tick += replay->events[replay->playback_index].tick_delta;
        } else {
            replay->playback_next_tick = UINT64_MAX;
        }
    }
    return replay->playback_buttons;
}

int td_replay_verify_finished(const TdReplay *replay, const TdGame *game)
{
    return game->tick == replay->final_tick && td_game_state_hash(game) == replay->final_hash;
}
