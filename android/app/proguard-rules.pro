# R8 keep rules.
#
# WHY THIS FILE HAS CONTENT NOW. Play flagged release 11 (1.8) with "Improve
# your app's memory and performance with R8 optimization" — the release build
# had minifyEnabled false, so nothing was shrunk, optimised or obfuscated.
#
# WHY IT IS THE DANGEROUS ONE OF THE THREE. The other two Play notes were
# deprecated API calls: wrong code, obvious fix, no runtime risk. R8 is the
# opposite. It is a whole-program transform on a LIVE app, and everything
# Capacitor does across the JS/native boundary is reflective — a plugin is
# found by annotation, its methods are invoked by name from JavaScript, and
# neither edge is a call site R8 can see. Left to its own analysis R8 would
# reasonably conclude those methods are unreachable and delete them, and the
# failure would not appear at build time. It would appear as a dead button on
# somebody's phone after an auto-update.
#
# So the rules below are deliberately generous where reflection is involved
# and quiet everywhere else, and android-build.yml re-reads R8's own usage
# report afterwards to prove the plugin surface actually survived rather than
# trusting that these rules say what I think they say.

# ---- Capacitor's bridge -----------------------------------------------------
# A plugin is discovered by its @CapacitorPlugin annotation and its methods are
# called by name, so both the class and the annotated methods must survive.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
# The annotations themselves have to stay readable at runtime, or the lookup
# above finds nothing even though the classes are present.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Anything reachable from the WebView's JS bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---- This app's own native surface -----------------------------------------
# Six plugins registered in MainActivity.onCreate plus the FCM service, which
# the SYSTEM instantiates from the manifest — never from our code, so R8 sees
# no reference to it at all.
-keep class com.oniqhub.app.** { *; }

# ---- Cordova plugins bridged through Capacitor ------------------------------
-keep class org.apache.cordova.** { *; }

# ---- Crash reports worth reading -------------------------------------------
# Without this a stack trace from Play arrives fully obfuscated. Line numbers
# cost a little size and are the difference between a diagnosable crash and a
# wall of a.b.c().
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
