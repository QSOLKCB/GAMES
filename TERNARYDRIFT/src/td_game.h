#ifndef TD_GAME_H
#define TD_GAME_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TD_VERSION 1u
#define TD_TICK_HZ 60u
#define TD_INTERNAL_WIDTH 480
#define TD_INTERNAL_HEIGHT 270
#define TD_SYSTEM_COUNT 3
#define TD_FACTION_COUNT 5
#define TD_COMMODITY_COUNT 4
#define TD_MAX_ENEMIES 3
#define TD_MAX_PROJECTILES 32
#define TD_MAX_SALVAGE 12
#define TD_REPLAY_MAX_EVENTS 8192
#define TD_SAVE_MAGIC 0x31534454u /* TDS1 */
#define TD_REPLAY_MAGIC 0x31524454u /* TDR1 */

typedef int32_t TdFix;

#define TD_FIX_ONE ((TdFix)65536)
#define TD_FIX_FROM_INT(value) ((TdFix)((value) * TD_FIX_ONE))
#define TD_FIX_TO_INT(value) ((int32_t)((value) / TD_FIX_ONE))

typedef struct TdVec2 {
    TdFix x;
    TdFix y;
} TdVec2;

typedef struct TdRng {
    uint64_t state;
    uint64_t increment;
} TdRng;

typedef enum TdFaction {
    TD_FACTION_MERIDIAN = 0,
    TD_FACTION_HELIX = 1,
    TD_FACTION_ORISON = 2,
    TD_FACTION_ASHWAKE = 3,
    TD_FACTION_PILGRIM = 4
} TdFaction;

typedef enum TdCommodity {
    TD_COMMODITY_FOOD = 0,
    TD_COMMODITY_ORE = 1,
    TD_COMMODITY_FUEL = 2,
    TD_COMMODITY_MEDICINE = 3
} TdCommodity;

typedef enum TdMissionType {
    TD_MISSION_NONE = 0,
    TD_MISSION_DELIVER = 1,
    TD_MISSION_BOUNTY = 2
} TdMissionType;

typedef enum TdInputBits {
    TD_INPUT_THRUST = 1u << 0,
    TD_INPUT_REVERSE = 1u << 1,
    TD_INPUT_TURN_LEFT = 1u << 2,
    TD_INPUT_TURN_RIGHT = 1u << 3,
    TD_INPUT_STRAFE_LEFT = 1u << 4,
    TD_INPUT_STRAFE_RIGHT = 1u << 5,
    TD_INPUT_FIRE = 1u << 6,
    TD_INPUT_INTERACT = 1u << 7,
    TD_INPUT_CRUISE = 1u << 8,
    TD_INPUT_ENGINE_KILL = 1u << 9,
    TD_INPUT_JUMP = 1u << 10,
    TD_INPUT_SELECT_PREV = 1u << 11,
    TD_INPUT_SELECT_NEXT = 1u << 12,
    TD_INPUT_BUY = 1u << 13,
    TD_INPUT_SELL = 1u << 14,
    TD_INPUT_LAUNCH = 1u << 15,
    TD_INPUT_MISSION = 1u << 16,
    TD_INPUT_UPGRADE = 1u << 17,
    TD_INPUT_REPAIR = 1u << 18
} TdInputBits;

typedef struct TdMarket {
    uint16_t inventory[TD_COMMODITY_COUNT];
    uint16_t target[TD_COMMODITY_COUNT];
    int8_t production[TD_COMMODITY_COUNT];
    uint8_t security;
    uint8_t faction;
} TdMarket;

typedef struct TdMusicGenome {
    uint8_t root_note;
    uint8_t scale_id;
    uint8_t tempo;
    uint8_t groove;
    uint8_t instrument_set;
    uint8_t motif_seed;
} TdMusicGenome;

typedef struct TdSystem {
    char name[16];
    uint32_t identity;
    TdVec2 station;
    TdVec2 gate;
    TdMarket market;
    TdMusicGenome music;
} TdSystem;

typedef struct TdPlayer {
    TdVec2 position;
    TdVec2 velocity;
    uint8_t heading;
    uint8_t system;
    uint8_t docked;
    uint8_t engine_kill;
    uint16_t hull;
    uint16_t hull_max;
    uint16_t shield;
    uint16_t shield_max;
    uint16_t energy;
    uint16_t energy_max;
    uint16_t heat;
    uint16_t fire_cooldown;
    uint32_t credits;
    uint8_t cargo[TD_COMMODITY_COUNT];
    uint8_t cargo_capacity;
    uint8_t engine_level;
    uint8_t weapon_level;
    uint8_t shield_level;
    int16_t reputation[TD_FACTION_COUNT];
} TdPlayer;

typedef struct TdEnemy {
    uint8_t active;
    uint8_t faction;
    uint8_t heading;
    uint8_t ai_phase;
    TdVec2 position;
    TdVec2 velocity;
    uint16_t hull;
    uint16_t shield;
    uint16_t fire_cooldown;
    uint16_t identity;
} TdEnemy;

typedef struct TdProjectile {
    uint8_t active;
    uint8_t hostile;
    uint8_t damage;
    uint8_t reserved;
    TdVec2 position;
    TdVec2 velocity;
    uint16_t lifetime;
    uint16_t identity;
} TdProjectile;

typedef struct TdSalvage {
    uint8_t active;
    uint8_t commodity;
    uint8_t quantity;
    uint8_t reserved;
    TdVec2 position;
    uint16_t identity;
} TdSalvage;

typedef struct TdMission {
    uint8_t type;
    uint8_t active;
    uint8_t origin_system;
    uint8_t destination_system;
    uint8_t commodity;
    uint8_t quantity;
    uint8_t target_faction;
    uint8_t reserved;
    uint32_t reward;
    uint64_t expiry_tick;
} TdMission;

typedef struct TdMusicQutrits {
    uint8_t navigation;
    uint8_t threat;
    uint8_t economy;
    uint8_t faction;
    uint8_t hull;
} TdMusicQutrits;

typedef struct TdGame {
    uint64_t universe_seed;
    uint64_t tick;
    TdRng economy_rng;
    TdRng mission_rng;
    TdRng combat_rng;
    TdSystem systems[TD_SYSTEM_COUNT];
    TdPlayer player;
    TdEnemy enemies[TD_MAX_ENEMIES];
    TdProjectile projectiles[TD_MAX_PROJECTILES];
    TdSalvage salvage[TD_MAX_SALVAGE];
    TdMission mission;
    TdMusicQutrits music_qutrits;
    uint32_t previous_input;
    uint32_t event_serial;
    uint32_t enemy_respawn_ticks;
    uint16_t market_ticks;
    uint8_t selected_commodity;
    uint8_t upgrade_cursor;
    uint8_t last_event;
    uint8_t replay_mode;
} TdGame;

typedef struct TdReplayEvent {
    uint32_t tick_delta;
    uint32_t buttons;
} TdReplayEvent;

typedef struct TdReplay {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint64_t universe_seed;
    uint64_t initial_hash;
    uint64_t final_hash;
    uint64_t final_tick;
    uint32_t event_count;
    uint32_t checksum;
    TdReplayEvent events[TD_REPLAY_MAX_EVENTS];
    uint32_t last_buttons;
    uint64_t last_event_tick;
    uint32_t playback_index;
    uint32_t playback_buttons;
    uint64_t playback_next_tick;
} TdReplay;

typedef struct TdSaveImage {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint32_t game_size;
    uint32_t checksum;
    uint64_t state_hash;
    TdGame game;
} TdSaveImage;

enum {
    TD_EVENT_NONE = 0,
    TD_EVENT_DOCKED,
    TD_EVENT_LAUNCHED,
    TD_EVENT_TRADE,
    TD_EVENT_NO_CREDITS,
    TD_EVENT_CARGO_FULL,
    TD_EVENT_MISSION_ACCEPTED,
    TD_EVENT_MISSION_COMPLETED,
    TD_EVENT_UPGRADED,
    TD_EVENT_REPAIRED,
    TD_EVENT_SALVAGED,
    TD_EVENT_JUMPED,
    TD_EVENT_ENEMY_DESTROYED,
    TD_EVENT_PLAYER_DESTROYED
};

extern const char *const td_faction_names[TD_FACTION_COUNT];
extern const char *const td_commodity_names[TD_COMMODITY_COUNT];

TdFix td_fix_mul(TdFix a, TdFix b);
uint32_t td_rng_next(TdRng *rng);
void td_game_init(TdGame *game, uint64_t universe_seed);
void td_game_step(TdGame *game, uint32_t input);
uint64_t td_game_state_hash(const TdGame *game);
uint16_t td_market_price(const TdGame *game, uint8_t system_index,
                         uint8_t commodity_index, int buying);
uint8_t td_player_cargo_used(const TdPlayer *player);
int td_near_station(const TdGame *game);
int td_near_gate(const TdGame *game);

void td_save_make(TdSaveImage *image, const TdGame *game);
int td_save_restore(TdGame *game, const TdSaveImage *image);

void td_replay_record_begin(TdReplay *replay, const TdGame *game);
int td_replay_record_input(TdReplay *replay, uint64_t tick, uint32_t buttons);
void td_replay_record_finish(TdReplay *replay, const TdGame *game);
int td_replay_play_begin(TdReplay *replay, TdGame *game);
uint32_t td_replay_input_for_tick(TdReplay *replay, uint64_t tick);
int td_replay_verify_finished(const TdReplay *replay, const TdGame *game);
uint32_t td_replay_checksum(const TdReplay *replay);

#ifdef __cplusplus
}
#endif

#endif
