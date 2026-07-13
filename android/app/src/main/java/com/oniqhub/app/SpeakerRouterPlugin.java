package com.oniqhub.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SpeakerRouter")
public class SpeakerRouterPlugin extends Plugin {

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        try {
            AudioManager audio = am();
            if (audio == null) { call.reject("AudioManager unavailable"); return; }
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(on);
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
                audio.setMode(AudioManager.MODE_NORMAL);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("reset failed: " + e.getMessage());
        }
    }
}
