package com.oniqhub.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Publish a finished video into the device's own Movies library.
 *
 * WHY THIS EXISTS. Saving used to be `<a download>` + a blob URL. That works in
 * a browser and does NOTHING in a Capacitor WebView: no DownloadListener is
 * attached, so the click is swallowed silently. The web layer then reported
 * success and told the server to purge the film — so "Save to my device"
 * destroyed the only copy and put nothing on the phone.
 *
 * MediaStore is used rather than a raw path because scoped storage (API 29+)
 * makes the public Movies directory unwritable by path, and MediaStore needs no
 * runtime permission for media the app itself inserts. The file also becomes
 * visible to the gallery, which is what "downloaded to my device" means to
 * somebody holding the phone. Below API 29 there is no MediaStore insert for
 * video without legacy storage permission, so we fall back to writing the
 * public Movies path directly.
 *
 * Copies stream-to-stream from a file the web layer already wrote, so a 20 MB
 * film never exists as a base64 string twice over.
 */
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

    @PluginMethod
    public void saveVideo(PluginCall call) {
        String srcPath = call.getString("path");
        String fileName = call.getString("fileName", "oniq-video.mp4");
        if (srcPath == null || srcPath.isEmpty()) {
            call.reject("path is required");
            return;
        }
        // Capacitor hands back file:// URIs; strip the scheme for File().
        if (srcPath.startsWith("file://")) srcPath = srcPath.substring(7);

        File src = new File(srcPath);
        if (!src.exists() || src.length() == 0) {
            call.reject("Nothing to save at " + srcPath);
            return;
        }

        try {
            Uri saved = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                ? saveViaMediaStore(src, fileName)
                : saveViaLegacyPath(src, fileName);
            if (saved == null) {
                call.reject("Could not create the destination file");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("uri", saved.toString());
            ret.put("bytes", src.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }

    private Uri saveViaMediaStore(File src, String fileName) throws Exception {
        Context ctx = getContext();
        ContentResolver resolver = ctx.getContentResolver();

        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
        values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/ONIQ");
        // IS_PENDING hides a half-written file from the gallery until the copy
        // finishes — otherwise a scanner can index a truncated video.
        values.put(MediaStore.Video.Media.IS_PENDING, 1);

        Uri dest = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        if (dest == null) return null;

        try (InputStream in = new FileInputStream(src);
             OutputStream out = resolver.openOutputStream(dest)) {
            if (out == null) throw new Exception("destination stream unavailable");
            copy(in, out);
        }

        values.clear();
        values.put(MediaStore.Video.Media.IS_PENDING, 0);
        resolver.update(dest, values, null, null);
        return dest;
    }

    private Uri saveViaLegacyPath(File src, String fileName) throws Exception {
        File dir = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "ONIQ");
        if (!dir.exists() && !dir.mkdirs()) return null;
        File dest = new File(dir, fileName);
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        // Make it visible to the gallery on pre-Q devices.
        try {
            android.media.MediaScannerConnection.scanFile(
                getContext(), new String[] { dest.getAbsolutePath() },
                new String[] { "video/mp4" }, null);
        } catch (Exception ignored) {
        }
        return Uri.fromFile(dest);
    }

    private void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }
}
