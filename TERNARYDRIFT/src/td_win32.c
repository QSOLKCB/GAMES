#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>

#include "td_audio.h"
#include "td_game.h"

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TD_WINDOW_CLASS "TernaryDriftWindow"
#define TD_AUDIO_BUFFERS 4
#define TD_AUDIO_BUFFER_FRAMES 1024

typedef struct TdWaveOut {
    HWAVEOUT handle;
    WAVEHDR headers[TD_AUDIO_BUFFERS];
    int16_t samples[TD_AUDIO_BUFFERS][TD_AUDIO_BUFFER_FRAMES * 2];
    uint8_t queued[TD_AUDIO_BUFFERS];
    uint8_t active;
} TdWaveOut;

typedef struct TdPlatform {
    HWND window;
    BITMAPINFO bitmap_info;
    uint32_t pixels[TD_INTERNAL_WIDTH * TD_INTERNAL_HEIGHT];
    uint8_t running;
    uint8_t previous_keys[256];
    uint8_t recording;
    uint8_t playback;
    uint8_t replay_verified;
    TdGame game;
    TdReplay replay;
    TdTracker tracker;
    TdWaveOut audio;
} TdPlatform;

static TdPlatform td_platform;

static const int16_t td_visual_directions[32][2] = {
    {32767, 0}, {32138, 6393}, {30273, 12539}, {27245, 18204},
    {23170, 23170}, {18204, 27245}, {12539, 30273}, {6393, 32138},
    {0, 32767}, {-6393, 32138}, {-12539, 30273}, {-18204, 27245},
    {-23170, 23170}, {-27245, 18204}, {-30273, 12539}, {-32138, 6393},
    {-32767, 0}, {-32138, -6393}, {-30273, -12539}, {-27245, -18204},
    {-23170, -23170}, {-18204, -27245}, {-12539, -30273}, {-6393, -32138},
    {0, -32767}, {6393, -32138}, {12539, -30273}, {18204, -27245},
    {23170, -23170}, {27245, -18204}, {30273, -12539}, {32138, -6393}
};

/* Five-column, seven-row glyphs for ASCII 32 through 90. */
static const uint8_t td_font[59][5] = {
    {0x00,0x00,0x00,0x00,0x00},{0x00,0x00,0x5f,0x00,0x00},
    {0x00,0x07,0x00,0x07,0x00},{0x14,0x7f,0x14,0x7f,0x14},
    {0x24,0x2a,0x7f,0x2a,0x12},{0x23,0x13,0x08,0x64,0x62},
    {0x36,0x49,0x55,0x22,0x50},{0x00,0x05,0x03,0x00,0x00},
    {0x00,0x1c,0x22,0x41,0x00},{0x00,0x41,0x22,0x1c,0x00},
    {0x14,0x08,0x3e,0x08,0x14},{0x08,0x08,0x3e,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},
    {0x00,0x60,0x60,0x00,0x00},{0x20,0x10,0x08,0x04,0x02},
    {0x3e,0x51,0x49,0x45,0x3e},{0x00,0x42,0x7f,0x40,0x00},
    {0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4b,0x31},
    {0x18,0x14,0x12,0x7f,0x10},{0x27,0x45,0x45,0x45,0x39},
    {0x3c,0x4a,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1e},
    {0x00,0x36,0x36,0x00,0x00},{0x00,0x56,0x36,0x00,0x00},
    {0x08,0x14,0x22,0x41,0x00},{0x14,0x14,0x14,0x14,0x14},
    {0x00,0x41,0x22,0x14,0x08},{0x02,0x01,0x51,0x09,0x06},
    {0x32,0x49,0x79,0x41,0x3e},{0x7e,0x11,0x11,0x11,0x7e},
    {0x7f,0x49,0x49,0x49,0x36},{0x3e,0x41,0x41,0x41,0x22},
    {0x7f,0x41,0x41,0x22,0x1c},{0x7f,0x49,0x49,0x49,0x41},
    {0x7f,0x09,0x09,0x09,0x01},{0x3e,0x41,0x49,0x49,0x7a},
    {0x7f,0x08,0x08,0x08,0x7f},{0x00,0x41,0x7f,0x41,0x00},
    {0x20,0x40,0x41,0x3f,0x01},{0x7f,0x08,0x14,0x22,0x41},
    {0x7f,0x40,0x40,0x40,0x40},{0x7f,0x02,0x0c,0x02,0x7f},
    {0x7f,0x04,0x08,0x10,0x7f},{0x3e,0x41,0x41,0x41,0x3e},
    {0x7f,0x09,0x09,0x09,0x06},{0x3e,0x41,0x51,0x21,0x5e},
    {0x7f,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},
    {0x01,0x01,0x7f,0x01,0x01},{0x3f,0x40,0x40,0x40,0x3f},
    {0x1f,0x20,0x40,0x20,0x1f},{0x3f,0x40,0x38,0x40,0x3f},
    {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},
    {0x61,0x51,0x49,0x45,0x43}
};

enum {
    TD_COLOUR_VOID = 0x00070b12u,
    TD_COLOUR_STAR = 0x006f7f84u,
    TD_COLOUR_UI = 0x00b9c8c2u,
    TD_COLOUR_DIM = 0x00576b70u,
    TD_COLOUR_PLAYER = 0x00d6c27au,
    TD_COLOUR_STATION = 0x007b8f91u,
    TD_COLOUR_GATE = 0x0073a0a4u,
    TD_COLOUR_ENEMY = 0x00b15b52u,
    TD_COLOUR_PROJECTILE = 0x00e0d59bu,
    TD_COLOUR_SHIELD = 0x006c9bb0u,
    TD_COLOUR_WARNING = 0x00d08255u,
    TD_COLOUR_SALVAGE = 0x0098a66bu,
    TD_COLOUR_PANEL = 0x00121d25u
};

static uint32_t td_hash_visual(uint32_t value)
{
    value ^= value >> 16u;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15u;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16u);
}

static void td_put_pixel(int x, int y, uint32_t colour)
{
    if ((unsigned)x < TD_INTERNAL_WIDTH && (unsigned)y < TD_INTERNAL_HEIGHT) {
        td_platform.pixels[y * TD_INTERNAL_WIDTH + x] = colour;
    }
}

static void td_fill_rect(int x, int y, int width, int height, uint32_t colour)
{
    int row;
    int column;
    for (row = 0; row < height; ++row) {
        for (column = 0; column < width; ++column) td_put_pixel(x + column, y + row, colour);
    }
}

static void td_line(int x0, int y0, int x1, int y1, uint32_t colour)
{
    int dx = abs(x1 - x0);
    int sx = x0 < x1 ? 1 : -1;
    int dy = -abs(y1 - y0);
    int sy = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    for (;;) {
        int doubled;
        td_put_pixel(x0, y0, colour);
        if (x0 == x1 && y0 == y1) break;
        doubled = error * 2;
        if (doubled >= dy) {
            error += dy;
            x0 += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y0 += sy;
        }
    }
}

static void td_circle(int centre_x, int centre_y, int radius, uint32_t colour)
{
    int x = -radius;
    int y = 0;
    int error = 2 - 2 * radius;
    do {
        td_put_pixel(centre_x - x, centre_y + y, colour);
        td_put_pixel(centre_x - y, centre_y - x, colour);
        td_put_pixel(centre_x + x, centre_y - y, colour);
        td_put_pixel(centre_x + y, centre_y + x, colour);
        radius = error;
        if (radius <= y) error += ++y * 2 + 1;
        if (radius > x || error > y) error += ++x * 2 + 1;
    } while (x < 0);
}

static void td_glyph(int x, int y, char character, uint32_t colour, int scale)
{
    int column;
    if (character >= 'a' && character <= 'z') character = (char)(character - 'a' + 'A');
    if (character < 32 || character > 90) character = '?';
    for (column = 0; column < 5; ++column) {
        uint8_t bits = td_font[(unsigned char)character - 32u][column];
        int row;
        for (row = 0; row < 7; ++row) {
            if ((bits & (1u << row)) != 0u) td_fill_rect(x + column * scale, y + row * scale, scale, scale, colour);
        }
    }
}

static void td_text(int x, int y, const char *text, uint32_t colour, int scale)
{
    while (*text != '\0') {
        td_glyph(x, y, *text++, colour, scale);
        x += 6 * scale;
    }
}

static void td_bar(int x, int y, int width, uint16_t value, uint16_t maximum, uint32_t colour)
{
    int fill = maximum == 0u ? 0 : (int)((uint32_t)width * value / maximum);
    td_fill_rect(x, y, width, 4, TD_COLOUR_PANEL);
    td_fill_rect(x, y, fill, 4, colour);
}

static void td_world_to_screen(const TdGame *game, TdVec2 world, int *x, int *y)
{
    *x = TD_INTERNAL_WIDTH / 2 + TD_FIX_TO_INT(world.x - game->player.position.x);
    *y = TD_INTERNAL_HEIGHT / 2 - TD_FIX_TO_INT(world.y - game->player.position.y);
}

static void td_draw_ship(TdVec2 world, uint8_t heading, uint32_t colour, int player)
{
    int centre_x;
    int centre_y;
    int index = (heading >> 3u) & 31u;
    int left = (index + 11) & 31;
    int right = (index + 21) & 31;
    int nose_x;
    int nose_y;
    int left_x;
    int left_y;
    int right_x;
    int right_y;
    td_world_to_screen(&td_platform.game, world, &centre_x, &centre_y);
    nose_x = centre_x + td_visual_directions[index][0] * (player ? 10 : 8) / 32768;
    nose_y = centre_y - td_visual_directions[index][1] * (player ? 10 : 8) / 32768;
    left_x = centre_x + td_visual_directions[left][0] * (player ? 7 : 6) / 32768;
    left_y = centre_y - td_visual_directions[left][1] * (player ? 7 : 6) / 32768;
    right_x = centre_x + td_visual_directions[right][0] * (player ? 7 : 6) / 32768;
    right_y = centre_y - td_visual_directions[right][1] * (player ? 7 : 6) / 32768;
    td_line(nose_x, nose_y, left_x, left_y, colour);
    td_line(left_x, left_y, centre_x, centre_y, colour);
    td_line(centre_x, centre_y, right_x, right_y, colour);
    td_line(right_x, right_y, nose_x, nose_y, colour);
}

static void td_draw_stars(const TdGame *game)
{
    uint32_t identity = game->systems[game->player.system].identity;
    uint32_t index;
    for (index = 0; index < 96u; ++index) {
        uint32_t value = td_hash_visual(identity ^ index * UINT32_C(0x9e3779b9));
        TdVec2 star;
        int x;
        int y;
        star.x = TD_FIX_FROM_INT((int32_t)(value % 2201u) - 1100);
        star.y = TD_FIX_FROM_INT((int32_t)((value >> 11u) % 1601u) - 800);
        td_world_to_screen(game, star, &x, &y);
        if ((unsigned)x < TD_INTERNAL_WIDTH && (unsigned)y < TD_INTERNAL_HEIGHT) {
            td_put_pixel(x, y, (value & 3u) == 0u ? TD_COLOUR_UI : TD_COLOUR_STAR);
        }
    }
}

static const char *td_event_text(uint8_t event_id)
{
    switch (event_id) {
    case TD_EVENT_DOCKED: return "DOCKING COMPLETE";
    case TD_EVENT_LAUNCHED: return "LAUNCH CLEAR";
    case TD_EVENT_TRADE: return "MARKET ORDER FILLED";
    case TD_EVENT_NO_CREDITS: return "INSUFFICIENT CREDITS";
    case TD_EVENT_CARGO_FULL: return "CARGO HOLD FULL";
    case TD_EVENT_MISSION_ACCEPTED: return "CONTRACT ACCEPTED";
    case TD_EVENT_MISSION_COMPLETED: return "CONTRACT COMPLETE";
    case TD_EVENT_UPGRADED: return "SYSTEM UPGRADED";
    case TD_EVENT_REPAIRED: return "HULL RESTORED";
    case TD_EVENT_SALVAGED: return "SALVAGE TRACTORED";
    case TD_EVENT_JUMPED: return "JUMP TRANSIT COMPLETE";
    case TD_EVENT_ENEMY_DESTROYED: return "ASHWAKE RAIDER DESTROYED";
    case TD_EVENT_PLAYER_DESTROYED: return "RECOVERED AT STATION";
    default: return "";
    }
}

static void td_draw_flight(void)
{
    TdGame *game = &td_platform.game;
    TdSystem *system = &game->systems[game->player.system];
    char text[96];
    int x;
    int y;
    uint8_t index;
    td_draw_stars(game);
    td_world_to_screen(game, system->station, &x, &y);
    if (x > -30 && x < TD_INTERNAL_WIDTH + 30 && y > -30 && y < TD_INTERNAL_HEIGHT + 30) {
        td_circle(x, y, 18, TD_COLOUR_STATION);
        td_circle(x, y, 7, TD_COLOUR_DIM);
        td_line(x - 24, y, x + 24, y, TD_COLOUR_STATION);
    }
    td_world_to_screen(game, system->gate, &x, &y);
    if (x > -40 && x < TD_INTERNAL_WIDTH + 40 && y > -40 && y < TD_INTERNAL_HEIGHT + 40) {
        td_circle(x, y, 25, TD_COLOUR_GATE);
        td_circle(x, y, 20, TD_COLOUR_DIM);
    }
    for (index = 0; index < TD_MAX_SALVAGE; ++index) {
        TdSalvage *salvage = &game->salvage[index];
        if (!salvage->active) continue;
        td_world_to_screen(game, salvage->position, &x, &y);
        td_line(x, y - 4, x + 4, y, TD_COLOUR_SALVAGE);
        td_line(x + 4, y, x, y + 4, TD_COLOUR_SALVAGE);
        td_line(x, y + 4, x - 4, y, TD_COLOUR_SALVAGE);
        td_line(x - 4, y, x, y - 4, TD_COLOUR_SALVAGE);
    }
    for (index = 0; index < TD_MAX_ENEMIES; ++index) {
        if (game->enemies[index].active) td_draw_ship(game->enemies[index].position,
            game->enemies[index].heading, TD_COLOUR_ENEMY, 0);
    }
    for (index = 0; index < TD_MAX_PROJECTILES; ++index) {
        TdProjectile *projectile = &game->projectiles[index];
        if (!projectile->active) continue;
        td_world_to_screen(game, projectile->position, &x, &y);
        td_put_pixel(x, y, projectile->hostile ? TD_COLOUR_WARNING : TD_COLOUR_PROJECTILE);
        td_put_pixel(x + 1, y, projectile->hostile ? TD_COLOUR_WARNING : TD_COLOUR_PROJECTILE);
    }
    td_draw_ship(game->player.position, game->player.heading, TD_COLOUR_PLAYER, 1);
    if (game->player.shield > 0) td_circle(TD_INTERNAL_WIDTH / 2, TD_INTERNAL_HEIGHT / 2, 13, TD_COLOUR_SHIELD);

    td_fill_rect(5, 5, 174, 32, TD_COLOUR_PANEL);
    snprintf(text, sizeof(text), "%s  %s", system->name, td_faction_names[system->market.faction]);
    td_text(9, 9, text, TD_COLOUR_UI, 1);
    td_text(9, 20, "HULL", TD_COLOUR_DIM, 1);
    td_bar(42, 21, 40, game->player.hull, game->player.hull_max, TD_COLOUR_WARNING);
    td_text(87, 20, "SHD", TD_COLOUR_DIM, 1);
    td_bar(110, 21, 28, game->player.shield, game->player.shield_max, TD_COLOUR_SHIELD);
    td_text(143, 20, "NRG", TD_COLOUR_DIM, 1);
    td_bar(165, 21, 10, game->player.energy, game->player.energy_max, TD_COLOUR_PLAYER);

    td_fill_rect(328, 5, 147, 32, TD_COLOUR_PANEL);
    snprintf(text, sizeof(text), "CR %lu  CARGO %u/%u", (unsigned long)game->player.credits,
        td_player_cargo_used(&game->player), game->player.cargo_capacity);
    td_text(333, 9, text, TD_COLOUR_UI, 1);
    snprintf(text, sizeof(text), "Q %u%u%u%u%u  %s", game->music_qutrits.navigation,
        game->music_qutrits.threat, game->music_qutrits.economy,
        game->music_qutrits.faction, game->music_qutrits.hull,
        game->player.engine_kill ? "DRIFT" : "ASSIST");
    td_text(333, 20, text, game->music_qutrits.threat == 2u ? TD_COLOUR_WARNING : TD_COLOUR_DIM, 1);

    td_fill_rect(5, 248, 470, 17, TD_COLOUR_PANEL);
    td_text(9, 253, "W/S THRUST  A/D STRAFE  ARROWS TURN  SPACE FIRE  E DOCK/SALVAGE  J JUMP  K DRIFT",
        TD_COLOUR_DIM, 1);
    if (game->last_event != TD_EVENT_NONE) td_text(183, 41, td_event_text(game->last_event), TD_COLOUR_PLAYER, 1);

    td_fill_rect(414, 188, 60, 56, TD_COLOUR_PANEL);
    td_circle(444, 216, 24, TD_COLOUR_DIM);
    td_put_pixel(444, 216, TD_COLOUR_PLAYER);
    td_world_to_screen(game, system->station, &x, &y);
    x = 444 + (x - TD_INTERNAL_WIDTH / 2) / 8;
    y = 216 + (y - TD_INTERNAL_HEIGHT / 2) / 8;
    if (x >= 420 && x <= 468 && y >= 192 && y <= 240) td_put_pixel(x, y, TD_COLOUR_STATION);
    if (game->enemies[0].active) {
        td_world_to_screen(game, game->enemies[0].position, &x, &y);
        x = 444 + (x - TD_INTERNAL_WIDTH / 2) / 8;
        y = 216 + (y - TD_INTERNAL_HEIGHT / 2) / 8;
        if (x >= 420 && x <= 468 && y >= 192 && y <= 240) td_put_pixel(x, y, TD_COLOUR_ENEMY);
    }
}

static void td_draw_docked(void)
{
    TdGame *game = &td_platform.game;
    TdSystem *system = &game->systems[game->player.system];
    char text[128];
    uint8_t index;
    td_fill_rect(0, 0, TD_INTERNAL_WIDTH, TD_INTERNAL_HEIGHT, TD_COLOUR_VOID);
    td_fill_rect(16, 15, 448, 240, TD_COLOUR_PANEL);
    snprintf(text, sizeof(text), "TERNARY DRIFT // %s STATION", system->name);
    td_text(25, 24, text, TD_COLOUR_PLAYER, 2);
    snprintf(text, sizeof(text), "%s CONTROL  SECURITY %u  CREDITS %lu  CARGO %u/%u",
        td_faction_names[system->market.faction], system->market.security,
        (unsigned long)game->player.credits, td_player_cargo_used(&game->player),
        game->player.cargo_capacity);
    td_text(25, 47, text, TD_COLOUR_UI, 1);
    td_text(25, 66, "MARKET", TD_COLOUR_UI, 1);
    td_text(25, 78, "GOOD        STOCK  BUY  SELL  HOLD", TD_COLOUR_DIM, 1);
    for (index = 0; index < TD_COMMODITY_COUNT; ++index) {
        int row_y = 91 + index * 13;
        snprintf(text, sizeof(text), "%-10s  %3u   %3u   %3u   %2u", td_commodity_names[index],
            system->market.inventory[index], td_market_price(game, game->player.system, index, 1),
            td_market_price(game, game->player.system, index, 0), game->player.cargo[index]);
        if (index == game->selected_commodity) td_fill_rect(22, row_y - 2, 236, 11, 0x00203136u);
        td_text(27, row_y, text, index == game->selected_commodity ? TD_COLOUR_PLAYER : TD_COLOUR_UI, 1);
    }

    td_text(283, 66, "CONTRACT", TD_COLOUR_UI, 1);
    if (!game->mission.active) {
        td_text(283, 79, "NO ACTIVE CONTRACT", TD_COLOUR_DIM, 1);
        td_text(283, 91, "PRESS M TO ACCEPT", TD_COLOUR_UI, 1);
    } else if (game->mission.type == TD_MISSION_DELIVER) {
        snprintf(text, sizeof(text), "DELIVER %u %s", game->mission.quantity,
            td_commodity_names[game->mission.commodity]);
        td_text(283, 79, text, TD_COLOUR_UI, 1);
        snprintf(text, sizeof(text), "TO %s  CR %lu", game->systems[game->mission.destination_system].name,
            (unsigned long)game->mission.reward);
        td_text(283, 91, text, TD_COLOUR_PLAYER, 1);
    } else {
        snprintf(text, sizeof(text), "BOUNTY IN %s", game->systems[game->mission.destination_system].name);
        td_text(283, 79, text, TD_COLOUR_UI, 1);
        snprintf(text, sizeof(text), "ASHWAKE RAIDER  CR %lu", (unsigned long)game->mission.reward);
        td_text(283, 91, text, TD_COLOUR_PLAYER, 1);
    }
    td_text(283, 120, "REFIT CYCLE", TD_COLOUR_UI, 1);
    snprintf(text, sizeof(text), "ENGINE %u  CANNON %u  SHIELD %u", game->player.engine_level,
        game->player.weapon_level, game->player.shield_level);
    td_text(283, 133, text, TD_COLOUR_DIM, 1);
    snprintf(text, sizeof(text), "NEXT %s  COST %lu", game->upgrade_cursor == 0 ? "ENGINE" :
        (game->upgrade_cursor == 1 ? "CANNON" : "SHIELD"),
        (unsigned long)(380u + (game->upgrade_cursor == 0 ? game->player.engine_level :
        (game->upgrade_cursor == 1 ? game->player.weapon_level : game->player.shield_level)) * 420u));
    td_text(283, 145, text, TD_COLOUR_UI, 1);
    snprintf(text, sizeof(text), "REPUTATION  M %d  H %d  O %d  A %d  P %d",
        game->player.reputation[0], game->player.reputation[1], game->player.reputation[2],
        game->player.reputation[3], game->player.reputation[4]);
    td_text(25, 164, text, TD_COLOUR_DIM, 1);
    snprintf(text, sizeof(text), "STATE %016llX  TICK %llu", (unsigned long long)td_game_state_hash(game),
        (unsigned long long)game->tick);
    td_text(25, 179, text, TD_COLOUR_DIM, 1);
    td_text(25, 205, "UP/DOWN SELECT   B BUY   S SELL   M CONTRACT   U UPGRADE   R REPAIR", TD_COLOUR_UI, 1);
    td_text(25, 220, "L LAUNCH   F5 SAVE   F6 LOAD   F9 RECORD/STOP   F10 REPLAY", TD_COLOUR_UI, 1);
    if (game->last_event != TD_EVENT_NONE) td_text(25, 237, td_event_text(game->last_event), TD_COLOUR_PLAYER, 1);
}

static void td_render(void)
{
    memset(td_platform.pixels, 0, sizeof(td_platform.pixels));
    if (td_platform.game.player.docked) td_draw_docked();
    else td_draw_flight();
    if (td_platform.recording) td_text(406, 41, "REC", TD_COLOUR_WARNING, 1);
    if (td_platform.playback) td_text(392, 41, "REPLAY", TD_COLOUR_GATE, 1);
    if (td_platform.replay_verified) td_text(358, 52, "REPLAY VERIFIED", TD_COLOUR_PLAYER, 1);
}

static void td_present(HDC device_context, int client_width, int client_height)
{
    int scale_x = client_width / TD_INTERNAL_WIDTH;
    int scale_y = client_height / TD_INTERNAL_HEIGHT;
    int scale = scale_x < scale_y ? scale_x : scale_y;
    int target_width;
    int target_height;
    int target_x;
    int target_y;
    if (scale < 1) scale = 1;
    target_width = TD_INTERNAL_WIDTH * scale;
    target_height = TD_INTERNAL_HEIGHT * scale;
    target_x = (client_width - target_width) / 2;
    target_y = (client_height - target_height) / 2;
    PatBlt(device_context, 0, 0, client_width, client_height, BLACKNESS);
    SetStretchBltMode(device_context, COLORONCOLOR);
    StretchDIBits(device_context, target_x, target_y, target_width, target_height,
        0, 0, TD_INTERNAL_WIDTH, TD_INTERNAL_HEIGHT, td_platform.pixels,
        &td_platform.bitmap_info, DIB_RGB_COLORS, SRCCOPY);
}

static int td_audio_init(TdWaveOut *audio, TdTracker *tracker)
{
    WAVEFORMATEX format;
    unsigned index;
    memset(audio, 0, sizeof(*audio));
    memset(&format, 0, sizeof(format));
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 2;
    format.nSamplesPerSec = TD_AUDIO_RATE;
    format.wBitsPerSample = 16;
    format.nBlockAlign = (WORD)(format.nChannels * format.wBitsPerSample / 8u);
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    if (waveOutOpen(&audio->handle, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) return 0;
    for (index = 0; index < TD_AUDIO_BUFFERS; ++index) {
        WAVEHDR *header = &audio->headers[index];
        memset(header, 0, sizeof(*header));
        td_tracker_render(tracker, audio->samples[index], TD_AUDIO_BUFFER_FRAMES);
        header->lpData = (LPSTR)audio->samples[index];
        header->dwBufferLength = sizeof(audio->samples[index]);
        if (waveOutPrepareHeader(audio->handle, header, sizeof(*header)) != MMSYSERR_NOERROR) return 0;
        if (waveOutWrite(audio->handle, header, sizeof(*header)) != MMSYSERR_NOERROR) return 0;
        audio->queued[index] = 1;
    }
    audio->active = 1;
    return 1;
}

static void td_audio_pump(TdWaveOut *audio, TdTracker *tracker, const TdGame *game)
{
    unsigned index;
    if (!audio->active) return;
    td_tracker_set_world(tracker, game->player.system, &game->systems[game->player.system].music,
        &game->music_qutrits);
    for (index = 0; index < TD_AUDIO_BUFFERS; ++index) {
        WAVEHDR *header = &audio->headers[index];
        if (audio->queued[index] && (header->dwFlags & WHDR_DONE) != 0u) {
            td_tracker_render(tracker, audio->samples[index], TD_AUDIO_BUFFER_FRAMES);
            header->dwBufferLength = sizeof(audio->samples[index]);
            if (waveOutWrite(audio->handle, header, sizeof(*header)) == MMSYSERR_NOERROR) {
                audio->queued[index] = 1;
            }
        }
    }
}

static void td_audio_shutdown(TdWaveOut *audio)
{
    unsigned index;
    if (!audio->handle) return;
    waveOutReset(audio->handle);
    for (index = 0; index < TD_AUDIO_BUFFERS; ++index) {
        waveOutUnprepareHeader(audio->handle, &audio->headers[index], sizeof(audio->headers[index]));
    }
    waveOutClose(audio->handle);
    memset(audio, 0, sizeof(*audio));
}

static int td_write_file(const char *path, const void *data, DWORD size)
{
    DWORD written = 0;
    HANDLE file = CreateFileA(path, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    int success;
    if (file == INVALID_HANDLE_VALUE) return 0;
    success = WriteFile(file, data, size, &written, 0) && written == size;
    CloseHandle(file);
    return success;
}

static int td_read_file(const char *path, void *data, DWORD capacity, DWORD *size)
{
    DWORD read = 0;
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0);
    int success;
    if (file == INVALID_HANDLE_VALUE) return 0;
    success = ReadFile(file, data, capacity, &read, 0);
    CloseHandle(file);
    if (size) *size = read;
    return success;
}

static int td_save_game(void)
{
    TdSaveImage image;
    td_save_make(&image, &td_platform.game);
    return td_write_file("TERNARY.SAV", &image, (DWORD)sizeof(image));
}

static int td_load_game(void)
{
    TdSaveImage image;
    DWORD size;
    if (!td_read_file("TERNARY.SAV", &image, (DWORD)sizeof(image), &size) || size != sizeof(image)) return 0;
    return td_save_restore(&td_platform.game, &image);
}

static int td_save_replay(void)
{
    size_t header_size = offsetof(TdReplay, events);
    size_t total_size = header_size + td_platform.replay.event_count * sizeof(TdReplayEvent);
    return td_write_file("TERNARY.RPL", &td_platform.replay, (DWORD)total_size);
}

static int td_load_replay(void)
{
    DWORD size;
    memset(&td_platform.replay, 0, sizeof(td_platform.replay));
    if (!td_read_file("TERNARY.RPL", &td_platform.replay, (DWORD)sizeof(td_platform.replay), &size)) return 0;
    if (size < offsetof(TdReplay, events)) return 0;
    if (td_platform.replay.event_count > TD_REPLAY_MAX_EVENTS) return 0;
    return size == offsetof(TdReplay, events) + td_platform.replay.event_count * sizeof(TdReplayEvent);
}

static int td_key_down(int virtual_key)
{
    return (GetAsyncKeyState(virtual_key) & 0x8000) != 0;
}

static int td_key_pressed(int virtual_key)
{
    int down = td_key_down(virtual_key);
    int pressed = down && !td_platform.previous_keys[virtual_key & 255];
    td_platform.previous_keys[virtual_key & 255] = (uint8_t)down;
    return pressed;
}

static uint32_t td_poll_game_input(void)
{
    uint32_t input = 0;
    if (td_key_down('W')) input |= TD_INPUT_THRUST;
    if (td_key_down('S')) input |= td_platform.game.player.docked ? TD_INPUT_SELL : TD_INPUT_REVERSE;
    if (td_key_down(VK_LEFT)) input |= TD_INPUT_TURN_LEFT;
    if (td_key_down(VK_RIGHT)) input |= TD_INPUT_TURN_RIGHT;
    if (td_key_down('A')) input |= TD_INPUT_STRAFE_LEFT;
    if (td_key_down('D')) input |= TD_INPUT_STRAFE_RIGHT;
    if (td_key_down(VK_SPACE)) input |= TD_INPUT_FIRE;
    if (td_key_down(VK_SHIFT)) input |= TD_INPUT_CRUISE;
    if (td_key_down('E')) input |= TD_INPUT_INTERACT;
    if (td_key_down('J')) input |= TD_INPUT_JUMP;
    if (td_key_down('K')) input |= TD_INPUT_ENGINE_KILL;
    if (td_key_down(VK_UP)) input |= TD_INPUT_SELECT_PREV;
    if (td_key_down(VK_DOWN)) input |= TD_INPUT_SELECT_NEXT;
    if (td_key_down('B')) input |= TD_INPUT_BUY;
    if (td_key_down('L')) input |= TD_INPUT_LAUNCH;
    if (td_key_down('M')) input |= TD_INPUT_MISSION;
    if (td_key_down('U')) input |= TD_INPUT_UPGRADE;
    if (td_key_down('R')) input |= TD_INPUT_REPAIR;
    return input;
}

static void td_reset_tracker(void)
{
    TdSystem *system = &td_platform.game.systems[td_platform.game.player.system];
    td_tracker_init(&td_platform.tracker, TD_AUDIO_RATE, td_platform.game.universe_seed, &system->music);
}

static void td_platform_commands(void)
{
    if (td_key_pressed(VK_F5) && !td_platform.playback) td_save_game();
    if (td_key_pressed(VK_F6) && !td_platform.recording && !td_platform.playback) {
        if (td_load_game()) td_reset_tracker();
    }
    if (td_key_pressed(VK_F9) && !td_platform.playback) {
        if (td_platform.recording) {
            td_replay_record_finish(&td_platform.replay, &td_platform.game);
            td_platform.recording = 0;
            td_save_replay();
        } else {
            uint64_t seed = td_platform.game.universe_seed;
            td_game_init(&td_platform.game, seed);
            td_replay_record_begin(&td_platform.replay, &td_platform.game);
            td_platform.recording = 1;
            td_platform.replay_verified = 0;
            td_reset_tracker();
        }
    }
    if (td_key_pressed(VK_F10) && !td_platform.recording && !td_platform.playback) {
        if (td_load_replay() && td_replay_play_begin(&td_platform.replay, &td_platform.game)) {
            td_platform.playback = 1;
            td_platform.replay_verified = 0;
            td_reset_tracker();
        }
    }
}

static void td_tick(void)
{
    uint32_t input;
    td_platform_commands();
    if (td_platform.playback) {
        input = td_replay_input_for_tick(&td_platform.replay, td_platform.game.tick);
    } else {
        input = td_poll_game_input();
        if (td_platform.recording && !td_replay_record_input(&td_platform.replay,
            td_platform.game.tick, input)) {
            td_platform.recording = 0;
        }
    }
    td_game_step(&td_platform.game, input);
    if (td_platform.playback && td_platform.game.tick >= td_platform.replay.final_tick) {
        td_platform.replay_verified = (uint8_t)td_replay_verify_finished(&td_platform.replay, &td_platform.game);
        td_platform.playback = 0;
    }
}

static LRESULT CALLBACK td_window_proc(HWND window, UINT message, WPARAM w_param, LPARAM l_param)
{
    switch (message) {
    case WM_CLOSE:
        td_platform.running = 0;
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        td_platform.running = 0;
        PostQuitMessage(0);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT paint;
        RECT client;
        HDC context = BeginPaint(window, &paint);
        GetClientRect(window, &client);
        td_present(context, client.right - client.left, client.bottom - client.top);
        EndPaint(window, &paint);
        return 0;
    }
    default:
        return DefWindowProcA(window, message, w_param, l_param);
    }
}

static uint64_t td_seed_from_command_line(void)
{
    const char *command = GetCommandLineA();
    char *end;
    uint64_t seed;
    while (*command != '\0' && *command != ' ') command++;
    while (*command == ' ') command++;
    if (*command == '\0') return UINT64_C(0x5445524e41525931);
    seed = (uint64_t)strtoull(command, &end, 0);
    return end == command || seed == 0 ? UINT64_C(0x5445524e41525931) : seed;
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous_instance, LPSTR command_line, int show_command)
{
    WNDCLASSA window_class;
    RECT window_rect = {0, 0, TD_INTERNAL_WIDTH * 2, TD_INTERNAL_HEIGHT * 2};
    LARGE_INTEGER frequency;
    LARGE_INTEGER previous_counter;
    int64_t accumulator = 0;
    MSG message;
    (void)previous_instance;
    (void)command_line;
    memset(&td_platform, 0, sizeof(td_platform));
    memset(&window_class, 0, sizeof(window_class));
    window_class.style = CS_OWNDC | CS_HREDRAW | CS_VREDRAW;
    window_class.lpfnWndProc = td_window_proc;
    window_class.hInstance = instance;
    window_class.hCursor = LoadCursorA(0, IDC_ARROW);
    window_class.lpszClassName = TD_WINDOW_CLASS;
    if (!RegisterClassA(&window_class)) return 1;
    AdjustWindowRect(&window_rect, WS_OVERLAPPEDWINDOW, FALSE);
    td_platform.window = CreateWindowExA(0, TD_WINDOW_CLASS,
        "Ternary Drift - Native Vertical Slice",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT,
        window_rect.right - window_rect.left, window_rect.bottom - window_rect.top,
        0, 0, instance, 0);
    if (!td_platform.window) return 2;
    td_platform.bitmap_info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    td_platform.bitmap_info.bmiHeader.biWidth = TD_INTERNAL_WIDTH;
    td_platform.bitmap_info.bmiHeader.biHeight = -TD_INTERNAL_HEIGHT;
    td_platform.bitmap_info.bmiHeader.biPlanes = 1;
    td_platform.bitmap_info.bmiHeader.biBitCount = 32;
    td_platform.bitmap_info.bmiHeader.biCompression = BI_RGB;
    td_game_init(&td_platform.game, td_seed_from_command_line());
    td_reset_tracker();
    (void)td_audio_init(&td_platform.audio, &td_platform.tracker);
    td_platform.running = 1;
    ShowWindow(td_platform.window, show_command);
    timeBeginPeriod(1);
    QueryPerformanceFrequency(&frequency);
    QueryPerformanceCounter(&previous_counter);
    while (td_platform.running) {
        LARGE_INTEGER now;
        int steps = 0;
        while (PeekMessageA(&message, 0, 0, 0, PM_REMOVE)) {
            if (message.message == WM_QUIT) td_platform.running = 0;
            TranslateMessage(&message);
            DispatchMessageA(&message);
        }
        QueryPerformanceCounter(&now);
        accumulator += (now.QuadPart - previous_counter.QuadPart) * TD_TICK_HZ;
        previous_counter = now;
        while (accumulator >= frequency.QuadPart && steps < 8) {
            td_tick();
            accumulator -= frequency.QuadPart;
            steps++;
        }
        if (steps == 8 && accumulator >= frequency.QuadPart) accumulator = frequency.QuadPart - 1;
        td_audio_pump(&td_platform.audio, &td_platform.tracker, &td_platform.game);
        td_render();
        InvalidateRect(td_platform.window, 0, FALSE);
        UpdateWindow(td_platform.window);
        Sleep(1);
    }
    timeEndPeriod(1);
    td_audio_shutdown(&td_platform.audio);
    return 0;
}
