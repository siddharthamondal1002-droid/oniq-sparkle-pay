package com.oniqhub.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Audio routing for WebRTC calls running inside the WebView.
 *
 * WHY CALLS WERE NEARLY INAUDIBLE. The old version did two lines —
 * setMode(MODE_IN_COMMUNICATION) and setSpeakerphoneOn() — and that
 * combination is actively harmful on its own:
 *
 *  - MODE_IN_COMMUNICATION tells the platform "a voice call is happening", so
 *    output is attenuated to the VOICE_CALL stream's level and routed to the
 *    earpiece. The WebView's WebRTC audio is still emitted on STREAM_MUSIC,
 *    so it lands quiet and off-axis: loud enough to prove the call works,
 *    too quiet to hold a conversation.
 *  - Nothing ever claimed AUDIO FOCUS. Without it the platform is free to
 *    duck us under anything else that holds focus, and some OEM skins duck
 *    hard.
 *  - The volume rocker still controlled STREAM_MUSIC (or the ring stream)
 *    while a call was up, so the one obvious user fix — press volume up —
 *    moved a stream nobody was listening to.
 *
 * So this plugin now takes focus, points the hardware keys at the stream that
 * is actually carrying the call, and raises that stream if the user had left
 * it low. It never lowers a stream the user chose to set high.
 */
@CapacitorPlugin(name = "SpeakerRouter")
public class SpeakerRouterPlugin extends Plugin {

    private AudioFocusRequest focusRequest;
    private boolean focusHeld = false;
    private int savedMode = AudioManager.MODE_NORMAL;
    private boolean savedModeValid = false;

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Claim focus as a voice call so nothing else ducks us mid-conversation. */
    private void acquireFocus(AudioManager audio) {
        if (focusHeld) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setWillPauseWhenDucked(false)
                    .build();
                audio.requestAudioFocus(focusRequest);
            } else {
                audio.requestAudioFocus(
                    null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
            }
            focusHeld = true;
        } catch (Exception ignored) {
            // Focus is an optimisation — never fail the call over it.
        }
    }

    private void releaseFocus(AudioManager audio) {
        if (!focusHeld) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                audio.abandonAudioFocusRequest(focusRequest);
            } else {
                audio.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {
        }
        focusRequest = null;
        focusHeld = false;
    }

    /**
     * Raise a stream toward audible if the user left it low, never lower it.
     * A phone parked at 2/15 on the call stream is indistinguishable from a
     * broken call, and that is a setting most people never knowingly touch.
     */
    private void ensureAudible(AudioManager audio, int stream) {
        try {
            int max = audio.getStreamMaxVolume(stream);
            if (max <= 0) return;
            int current = audio.getStreamVolume(stream);
            int floor = (int) Math.ceil(max * 0.8);
            if (current < floor) {
                audio.setStreamVolume(stream, floor, 0);
            }
        } catch (Exception ignored) {
            // Some OEMs refuse programmatic volume changes; the rocker still works.
        }
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        try {
            AudioManager audio = am();
            if (audio == null) { call.reject("AudioManager unavailable"); return; }

            if (!savedModeValid) {
                savedMode = audio.getMode();
                savedModeValid = true;
            }
            acquireFocus(audio);
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(on);

            // The WebView emits on STREAM_MUSIC; MODE_IN_COMMUNICATION meters
            // on STREAM_VOICE_CALL. Both are in play depending on OEM and
            // route, so make both audible rather than betting on one.
            ensureAudible(audio, AudioManager.STREAM_VOICE_CALL);
            ensureAudible(audio, AudioManager.STREAM_MUSIC);

            // Point the hardware keys at the call so "press volume up" works.
            final android.app.Activity act = getActivity();
            if (act != null) {
                act.runOnUiThread(() -> {
                    try {
                        act.setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
                    } catch (Exception ignored) {
                    }
                });
            }

            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("setSpeaker failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void reset(PluginCall call) {
        try {
            AudioManager audio = am();
            if (audio != null) {
                audio.setSpeakerphoneOn(false);
                audio.setMode(savedModeValid ? savedMode : AudioManager.MODE_NORMAL);
                releaseFocus(audio);
            }
            savedModeValid = false;
            final android.app.Activity act = getActivity();
            if (act != null) {
                act.runOnUiThread(() -> {
                    try {
                        act.setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);
                    } catch (Exception ignored) {
                    }
                });
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("reset failed: " + e.getMessage());
        }
    }
}
