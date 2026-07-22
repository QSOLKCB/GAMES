#ifndef TD_AUDIO_H
#define TD_AUDIO_H

#include "td_game.h"

#include <stddef.h>
#include <stdint.h>

#define TD_AUDIO_RATE 22050u
#define TD_TRACKER_CHANNELS 4
#define TD_TRACKER_ROWS 32

typedef enum TdTrackerEffect {
    TD_FX_ARPEGGIO = 0x0,
    TD_FX_PORTA_UP = 0x1,
    TD_FX_PORTA_DOWN = 0x2,
    TD_FX_TONE_PORTA = 0x3,
    TD_FX_VIBRATO = 0x4,
    TD_FX_PATTERN_JUMP = 0xB,
    TD_FX_VOLUME = 0xC,
    TD_FX_PATTERN_BREAK = 0xD,
    TD_FX_SPEED_TEMPO = 0xF,
    TD_FX_VOLUME_SLIDE = 0xA
} TdTrackerEffect;

typedef struct TdTrackerCell {
    uint8_t note;
    uint8_t instrument;
    uint8_t volume;
    uint8_t effect;
    uint8_t parameter;
} TdTrackerCell;

typedef struct TdTrackerVoice {
    uint32_t phase;
    uint32_t increment;
    uint32_t base_increment;
    uint32_t target_increment;
    uint32_t noise;
    uint8_t note;
    uint8_t instrument;
    uint8_t volume;
    uint8_t effect;
    uint8_t parameter;
    uint8_t vibrato_phase;
    int8_t pan;
} TdTrackerVoice;

typedef struct TdTracker {
    uint32_t sample_rate;
    uint32_t samples_to_tick;
    uint32_t samples_per_tick;
    uint32_t note_increment[96];
    uint64_t universe_seed;
    uint64_t event_hash;
    uint32_t bar;
    uint8_t row;
    uint8_t tick_in_row;
    uint8_t speed;
    uint8_t tempo;
    uint8_t current_system;
    uint8_t variant;
    TdMusicGenome genome;
    TdMusicQutrits active_qutrits;
    TdMusicQutrits pending_qutrits;
    TdTrackerVoice voices[TD_TRACKER_CHANNELS];
} TdTracker;

void td_tracker_init(TdTracker *tracker, uint32_t sample_rate,
                     uint64_t universe_seed, const TdMusicGenome *genome);
void td_tracker_set_world(TdTracker *tracker, uint8_t system_index,
                          const TdMusicGenome *genome,
                          const TdMusicQutrits *qutrits);
void td_tracker_render(TdTracker *tracker, int16_t *interleaved_stereo,
                       size_t frame_count);
uint64_t td_tracker_event_hash(const TdTracker *tracker);

#endif
