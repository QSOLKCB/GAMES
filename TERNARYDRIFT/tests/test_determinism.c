#include "td_audio.h"
#include "td_game.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { \
    if (!(condition)) { \
        fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #condition); \
        return 1; \
    } \
} while (0)

static uint32_t scripted_input(uint64_t tick)
{
    uint32_t input = 0;
    if ((tick % 240u) < 110u) input |= TD_INPUT_THRUST;
    if ((tick % 360u) >= 120u && (tick % 360u) < 190u) input |= TD_INPUT_TURN_RIGHT;
    if ((tick % 500u) >= 300u && (tick % 500u) < 360u) input |= TD_INPUT_STRAFE_LEFT;
    if ((tick % 17u) < 3u) input |= TD_INPUT_FIRE;
    if ((tick % 700u) == 400u) input |= TD_INPUT_ENGINE_KILL;
    return input;
}

static int test_repeated_simulation(void)
{
    TdGame first;
    TdGame second;
    TdGame different;
    uint64_t tick;
    td_game_init(&first, UINT64_C(0x5445524e41525931));
    td_game_init(&second, UINT64_C(0x5445524e41525931));
    td_game_init(&different, UINT64_C(0x5445524e41525932));
    CHECK(td_game_state_hash(&first) == td_game_state_hash(&second));
    CHECK(td_game_state_hash(&first) != td_game_state_hash(&different));
    for (tick = 0; tick < 24000u; ++tick) {
        uint32_t input = scripted_input(tick);
        td_game_step(&first, input);
        td_game_step(&second, input);
        if ((tick % 251u) == 0u) CHECK(td_game_state_hash(&first) == td_game_state_hash(&second));
    }
    CHECK(td_game_state_hash(&first) == td_game_state_hash(&second));
    CHECK(first.music_qutrits.navigation <= 2u);
    CHECK(first.music_qutrits.threat <= 2u);
    CHECK(first.music_qutrits.economy <= 2u);
    CHECK(first.music_qutrits.faction <= 2u);
    CHECK(first.music_qutrits.hull <= 2u);
    CHECK(td_game_state_hash(&first) == UINT64_C(0xe35947a0e5ecdaf1));
    printf("simulation hash: %016llx\n", (unsigned long long)td_game_state_hash(&first));
    return 0;
}

static int test_market_mission_and_jump(void)
{
    TdGame game;
    uint32_t credits;
    uint16_t stock;
    TdSystem *system;
    td_game_init(&game, UINT64_C(0x5445524e41525931));
    game.player.docked = 1;
    credits = game.player.credits;
    stock = game.systems[0].market.inventory[0];
    td_game_step(&game, TD_INPUT_BUY);
    td_game_step(&game, 0);
    CHECK(game.player.cargo[0] == 1u);
    CHECK(game.player.credits < credits);
    CHECK(game.systems[0].market.inventory[0] + 1u == stock);
    td_game_step(&game, TD_INPUT_SELL);
    td_game_step(&game, 0);
    CHECK(game.player.cargo[0] == 0u);
    td_game_step(&game, TD_INPUT_MISSION);
    td_game_step(&game, 0);
    CHECK(game.mission.active == 1u);
    CHECK(game.mission.type == TD_MISSION_DELIVER || game.mission.type == TD_MISSION_BOUNTY);
    td_game_step(&game, TD_INPUT_LAUNCH);
    td_game_step(&game, 0);
    CHECK(game.player.docked == 0u);
    system = &game.systems[game.player.system];
    game.player.position = system->gate;
    td_game_step(&game, TD_INPUT_JUMP);
    td_game_step(&game, 0);
    CHECK(game.player.system == 1u);
    return 0;
}

static int test_save_round_trip(void)
{
    TdGame game;
    TdGame restored;
    TdSaveImage image;
    uint64_t tick;
    td_game_init(&game, UINT64_C(0x1020304050607080));
    for (tick = 0; tick < 4000u; ++tick) td_game_step(&game, scripted_input(tick));
    td_save_make(&image, &game);
    memset(&restored, 0xa5, sizeof(restored));
    CHECK(td_save_restore(&restored, &image));
    CHECK(td_game_state_hash(&restored) == td_game_state_hash(&game));
    image.state_hash ^= 1u;
    CHECK(!td_save_restore(&restored, &image));
    return 0;
}

static int test_replay(void)
{
    TdGame recorded;
    TdGame played;
    TdReplay *replay = (TdReplay *)malloc(sizeof(TdReplay));
    uint64_t tick;
    CHECK(replay != NULL);
    td_game_init(&recorded, UINT64_C(0xabcddcba12344321));
    td_replay_record_begin(replay, &recorded);
    for (tick = 0; tick < 9000u; ++tick) {
        uint32_t input = scripted_input(tick);
        CHECK(td_replay_record_input(replay, recorded.tick, input));
        td_game_step(&recorded, input);
    }
    td_replay_record_finish(replay, &recorded);
    CHECK(replay->event_count < 3000u);
    CHECK(td_replay_play_begin(replay, &played));
    while (played.tick < replay->final_tick) {
        uint32_t input = td_replay_input_for_tick(replay, played.tick);
        td_game_step(&played, input);
    }
    CHECK(td_replay_verify_finished(replay, &played));
    free(replay);
    return 0;
}

static int test_tracker_determinism(void)
{
    TdGame game;
    TdTracker first;
    TdTracker second;
    int16_t first_buffer[2048];
    int16_t second_buffer[2048];
    unsigned block;
    td_game_init(&game, UINT64_C(0x5445524e41525931));
    td_tracker_init(&first, TD_AUDIO_RATE, game.universe_seed, &game.systems[0].music);
    td_tracker_init(&second, TD_AUDIO_RATE, game.universe_seed, &game.systems[0].music);
    for (block = 0; block < 80u; ++block) {
        if (block == 25u) {
            game.music_qutrits.threat = 2;
            game.music_qutrits.hull = 1;
        }
        td_tracker_set_world(&first, 0, &game.systems[0].music, &game.music_qutrits);
        td_tracker_set_world(&second, 0, &game.systems[0].music, &game.music_qutrits);
        td_tracker_render(&first, first_buffer, 1024);
        td_tracker_render(&second, second_buffer, 1024);
        CHECK(memcmp(first_buffer, second_buffer, sizeof(first_buffer)) == 0);
    }
    CHECK(td_tracker_event_hash(&first) == td_tracker_event_hash(&second));
    CHECK(td_tracker_event_hash(&first) != UINT64_C(1469598103934665603));
    CHECK(td_tracker_event_hash(&first) == UINT64_C(0xf98bfeee42eb26f5));
    printf("tracker hash:    %016llx\n", (unsigned long long)td_tracker_event_hash(&first));
    return 0;
}

int main(void)
{
    if (test_repeated_simulation()) return 1;
    if (test_market_mission_and_jump()) return 1;
    if (test_save_round_trip()) return 1;
    if (test_replay()) return 1;
    if (test_tracker_determinism()) return 1;
    puts("all deterministic core tests passed");
    return 0;
}
