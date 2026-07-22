#include "td_audio.h"

#include <string.h>

static uint32_t td_mix32(uint32_t value)
{
    value ^= value >> 16u;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15u;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16u);
}

static uint8_t td_qutrit(uint8_t value)
{
    return value > 2u ? 2u : value;
}

static void td_tracker_recalculate_tick(TdTracker *tracker)
{
    uint32_t tempo = tracker->tempo < 32u ? 32u : tracker->tempo;
    tracker->samples_per_tick = (tracker->sample_rate * 5u) / (tempo * 2u);
    if (tracker->samples_per_tick == 0u) tracker->samples_per_tick = 1u;
}

static void td_tracker_build_notes(TdTracker *tracker)
{
    int note;
    uint64_t a4 = (UINT64_C(440) << 32u) / tracker->sample_rate;
    tracker->note_increment[69] = (uint32_t)a4;
    for (note = 70; note < 96; ++note) {
        tracker->note_increment[note] =
            (uint32_t)(((uint64_t)tracker->note_increment[note - 1] * 69433u) >> 16u);
    }
    for (note = 68; note >= 0; --note) {
        tracker->note_increment[note] =
            (uint32_t)(((uint64_t)tracker->note_increment[note + 1] * 61858u) >> 16u);
    }
}

static uint64_t td_event_byte(uint64_t hash, uint8_t value)
{
    return (hash ^ value) * UINT64_C(1099511628211);
}

static void td_hash_cell(TdTracker *tracker, uint8_t channel, const TdTrackerCell *cell)
{
    tracker->event_hash = td_event_byte(tracker->event_hash, tracker->row);
    tracker->event_hash = td_event_byte(tracker->event_hash, channel);
    tracker->event_hash = td_event_byte(tracker->event_hash, cell->note);
    tracker->event_hash = td_event_byte(tracker->event_hash, cell->instrument);
    tracker->event_hash = td_event_byte(tracker->event_hash, cell->volume);
    tracker->event_hash = td_event_byte(tracker->event_hash, cell->effect);
    tracker->event_hash = td_event_byte(tracker->event_hash, cell->parameter);
}

static uint8_t td_scale_note(const TdTracker *tracker, uint8_t degree, uint8_t octave)
{
    static const uint8_t scales[3][7] = {
        {0, 2, 3, 5, 7, 8, 10},
        {0, 2, 3, 5, 7, 9, 10},
        {0, 1, 3, 5, 6, 8, 10}
    };
    uint8_t scale = tracker->genome.scale_id % 3u;
    uint16_t note = (uint16_t)((uint16_t)tracker->genome.root_note +
        (uint16_t)scales[scale][degree % 7u] + (uint16_t)octave * 12u);
    return note > 95u ? 95u : (uint8_t)note;
}

static TdTrackerCell td_compile_cell(const TdTracker *tracker, uint8_t channel)
{
    TdTrackerCell cell;
    uint32_t identity = td_mix32((uint32_t)tracker->universe_seed ^
        tracker->bar * UINT32_C(0x9e3779b9) ^
        channel * UINT32_C(0x85ebca6b) ^ tracker->genome.motif_seed);
    uint8_t row = tracker->row;
    uint8_t threat = tracker->active_qutrits.threat;
    uint8_t economy = tracker->active_qutrits.economy;
    uint8_t hull = tracker->active_qutrits.hull;
    memset(&cell, 0, sizeof(cell));
    cell.volume = 40;

    if (channel == 0u) {
        uint8_t interval = economy == 0u ? 8u : (economy == 1u ? 4u : 2u);
        if ((row % interval) == 0u) {
            uint8_t degree = (uint8_t)((identity >> ((row / interval) & 15u)) % 7u);
            cell.note = td_scale_note(tracker, degree, 0);
            cell.instrument = 1;
            cell.volume = (uint8_t)(34u + economy * 6u);
            if (economy == 2u && (row & 3u) == 2u) {
                cell.effect = TD_FX_ARPEGGIO;
                cell.parameter = 0x37;
            }
        }
    } else if (channel == 1u) {
        uint8_t interval = threat == 2u ? 4u : 8u;
        if ((row % interval) == 0u) {
            cell.note = td_scale_note(tracker, (uint8_t)((row / interval + 4u) % 7u), 1);
            cell.instrument = 2;
            cell.volume = (uint8_t)(22u + threat * 5u);
            cell.effect = threat == 0u ? TD_FX_VOLUME_SLIDE : TD_FX_VIBRATO;
            cell.parameter = threat == 0u ? 0x01u : (uint8_t)(0x24u + threat);
        }
    } else if (channel == 2u) {
        int trigger = 0;
        if ((row & 7u) == 0u) {
            cell.note = 36;
            trigger = 1;
        } else if ((row & 7u) == 4u && threat > 0u) {
            cell.note = 40;
            trigger = 1;
        } else if (threat == 2u && (row & 1u) != 0u) {
            cell.note = 44;
            trigger = 1;
        }
        if (trigger) {
            cell.instrument = 3;
            cell.volume = (uint8_t)(32u + threat * 8u);
        }
    } else {
        if (threat > 0u && (row % (threat == 2u ? 4u : 8u)) == (identity & 3u)) {
            uint8_t degree = (uint8_t)((identity >> (row & 15u)) % 7u);
            cell.note = td_scale_note(tracker, degree, 2);
            cell.instrument = 4;
            cell.volume = (uint8_t)(20u + threat * 8u);
            cell.effect = hull == 2u ? TD_FX_PORTA_DOWN : TD_FX_TONE_PORTA;
            cell.parameter = hull == 2u ? 3u : 5u;
        }
    }
    return cell;
}

static void td_apply_cell(TdTracker *tracker, uint8_t channel, const TdTrackerCell *cell)
{
    TdTrackerVoice *voice = &tracker->voices[channel];
    td_hash_cell(tracker, channel, cell);
    if (cell->instrument != 0u) voice->instrument = cell->instrument;
    if (cell->volume != 0u) voice->volume = cell->volume > 64u ? 64u : cell->volume;
    voice->effect = cell->effect;
    voice->parameter = cell->parameter;
    if (cell->note > 0u && cell->note < 96u) {
        uint32_t increment = tracker->note_increment[cell->note];
        voice->note = cell->note;
        if (cell->effect == TD_FX_TONE_PORTA && voice->increment != 0u) {
            voice->target_increment = increment;
        } else {
            voice->increment = increment;
            voice->base_increment = increment;
            voice->target_increment = increment;
            if (voice->instrument == 3u) voice->noise ^= td_mix32((uint32_t)tracker->bar + tracker->row);
        }
    }
    if (cell->effect == TD_FX_VOLUME) voice->volume = cell->parameter > 64u ? 64u : cell->parameter;
    if (cell->effect == TD_FX_SPEED_TEMPO) {
        if (cell->parameter < 32u && cell->parameter > 0u) tracker->speed = cell->parameter;
        else if (cell->parameter >= 32u) {
            tracker->tempo = cell->parameter;
            td_tracker_recalculate_tick(tracker);
        }
    }
}

static void td_apply_tick_effect(TdTracker *tracker, TdTrackerVoice *voice)
{
    uint32_t amount;
    switch (voice->effect) {
    case TD_FX_ARPEGGIO: {
        uint8_t offset = tracker->tick_in_row % 3u == 1u ? (uint8_t)(voice->parameter >> 4u) :
            (uint8_t)(tracker->tick_in_row % 3u == 2u ? voice->parameter & 15u : 0u);
        uint8_t note = (uint8_t)(voice->note + offset);
        voice->increment = tracker->note_increment[note < 96u ? note : 95u];
        break;
    }
    case TD_FX_PORTA_UP:
        voice->increment += (uint32_t)voice->parameter * 240u;
        voice->base_increment = voice->increment;
        break;
    case TD_FX_PORTA_DOWN:
        amount = (uint32_t)voice->parameter * 240u;
        voice->increment = voice->increment > amount ? voice->increment - amount : 1u;
        voice->base_increment = voice->increment;
        break;
    case TD_FX_TONE_PORTA:
        amount = (uint32_t)voice->parameter * 320u;
        if (voice->increment < voice->target_increment) {
            uint32_t next = voice->increment + amount;
            voice->increment = next > voice->target_increment ? voice->target_increment : next;
        } else if (voice->increment > voice->target_increment) {
            voice->increment = voice->increment - voice->target_increment < amount ?
                voice->target_increment : voice->increment - amount;
        }
        voice->base_increment = voice->increment;
        break;
    case TD_FX_VIBRATO: {
        static const int8_t wave[16] = {0, 6, 11, 14, 15, 14, 11, 6, 0, -6, -11, -14, -15, -14, -11, -6};
        int32_t depth = (int32_t)(voice->parameter & 15u) * 80;
        int32_t modulation;
        voice->vibrato_phase = (uint8_t)(voice->vibrato_phase + (voice->parameter >> 4u));
        modulation = wave[voice->vibrato_phase & 15u] * depth;
        voice->increment = (uint32_t)((int64_t)voice->base_increment + modulation);
        break;
    }
    case TD_FX_VOLUME_SLIDE: {
        int32_t volume = (int32_t)voice->volume + (int32_t)(voice->parameter >> 4u) -
            (int32_t)(voice->parameter & 15u);
        if (volume < 0) volume = 0;
        if (volume > 64) volume = 64;
        voice->volume = (uint8_t)volume;
        break;
    }
    default:
        break;
    }
}

static void td_tracker_process_tick(TdTracker *tracker)
{
    uint8_t channel;
    if (tracker->tick_in_row == 0u) {
        if ((tracker->row & 7u) == 0u) {
            tracker->active_qutrits = tracker->pending_qutrits;
            tracker->variant = (uint8_t)(td_mix32((uint32_t)tracker->universe_seed ^ tracker->bar ^
                tracker->active_qutrits.threat * 17u ^ tracker->active_qutrits.economy * 31u) % 3u);
        }
        for (channel = 0; channel < TD_TRACKER_CHANNELS; ++channel) {
            TdTrackerCell cell = td_compile_cell(tracker, channel);
            td_apply_cell(tracker, channel, &cell);
        }
    } else {
        for (channel = 0; channel < TD_TRACKER_CHANNELS; ++channel) {
            td_apply_tick_effect(tracker, &tracker->voices[channel]);
        }
    }
    tracker->tick_in_row += 1u;
    if (tracker->tick_in_row >= tracker->speed) {
        tracker->tick_in_row = 0;
        tracker->row += 1u;
        if (tracker->row >= TD_TRACKER_ROWS) {
            tracker->row = 0;
            tracker->bar += 1u;
        }
    }
}

void td_tracker_init(TdTracker *tracker, uint32_t sample_rate,
                     uint64_t universe_seed, const TdMusicGenome *genome)
{
    uint8_t channel;
    memset(tracker, 0, sizeof(*tracker));
    tracker->sample_rate = sample_rate == 0u ? TD_AUDIO_RATE : sample_rate;
    tracker->universe_seed = universe_seed;
    tracker->event_hash = UINT64_C(1469598103934665603);
    tracker->speed = 6;
    tracker->tempo = genome->tempo;
    tracker->genome = *genome;
    tracker->active_qutrits.navigation = 0;
    tracker->active_qutrits.threat = 0;
    tracker->active_qutrits.economy = 1;
    tracker->active_qutrits.faction = 1;
    tracker->active_qutrits.hull = 0;
    tracker->pending_qutrits = tracker->active_qutrits;
    td_tracker_build_notes(tracker);
    td_tracker_recalculate_tick(tracker);
    tracker->samples_to_tick = 1;
    for (channel = 0; channel < TD_TRACKER_CHANNELS; ++channel) {
        tracker->voices[channel].noise = td_mix32((uint32_t)universe_seed ^ (channel + 1u) * UINT32_C(0x9e3779b9));
        tracker->voices[channel].pan = (int8_t)(channel == 0u ? -18 : (channel == 3u ? 18 : 0));
    }
}

void td_tracker_set_world(TdTracker *tracker, uint8_t system_index,
                          const TdMusicGenome *genome,
                          const TdMusicQutrits *qutrits)
{
    if (system_index != tracker->current_system) {
        tracker->current_system = system_index;
        tracker->genome = *genome;
        tracker->tempo = genome->tempo;
        td_tracker_recalculate_tick(tracker);
    }
    tracker->pending_qutrits.navigation = td_qutrit(qutrits->navigation);
    tracker->pending_qutrits.threat = td_qutrit(qutrits->threat);
    tracker->pending_qutrits.economy = td_qutrit(qutrits->economy);
    tracker->pending_qutrits.faction = td_qutrit(qutrits->faction);
    tracker->pending_qutrits.hull = td_qutrit(qutrits->hull);
}

static int32_t td_voice_sample(TdTrackerVoice *voice)
{
    uint32_t phase;
    int32_t sample;
    if (voice->increment == 0u || voice->volume == 0u) return 0;
    voice->phase += voice->increment;
    phase = voice->phase;
    if (voice->instrument == 1u) {
        sample = (phase & UINT32_C(0x80000000)) ? -11000 : 11000;
    } else if (voice->instrument == 2u) {
        uint32_t folded = (phase & UINT32_C(0x80000000)) ? ~phase : phase;
        sample = ((int32_t)(folded >> 16u) - 16384) / 2;
    } else if (voice->instrument == 3u) {
        voice->noise ^= voice->noise << 13u;
        voice->noise ^= voice->noise >> 17u;
        voice->noise ^= voice->noise << 5u;
        sample = (int32_t)(voice->noise & 0xffffu) - 32768;
        voice->volume = voice->volume > 2u ? (uint8_t)(voice->volume - 2u) : 0u;
    } else {
        sample = ((int32_t)(phase >> 16u) - 32768) / 3;
    }
    return (sample * voice->volume) / 64;
}

void td_tracker_render(TdTracker *tracker, int16_t *interleaved_stereo,
                       size_t frame_count)
{
    size_t frame;
    for (frame = 0; frame < frame_count; ++frame) {
        int32_t left = 0;
        int32_t right = 0;
        uint8_t channel;
        if (tracker->samples_to_tick == 0u) {
            td_tracker_process_tick(tracker);
            tracker->samples_to_tick = tracker->samples_per_tick;
        }
        tracker->samples_to_tick -= 1u;
        for (channel = 0; channel < TD_TRACKER_CHANNELS; ++channel) {
            TdTrackerVoice *voice = &tracker->voices[channel];
            int32_t sample = td_voice_sample(voice);
            left += sample * (64 - voice->pan) / 64;
            right += sample * (64 + voice->pan) / 64;
        }
        if (left < -32768) left = -32768;
        if (left > 32767) left = 32767;
        if (right < -32768) right = -32768;
        if (right > 32767) right = 32767;
        interleaved_stereo[frame * 2u] = (int16_t)left;
        interleaved_stereo[frame * 2u + 1u] = (int16_t)right;
    }
}

uint64_t td_tracker_event_hash(const TdTracker *tracker)
{
    return tracker->event_hash;
}
