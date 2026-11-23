package dev.coderize.cloudsave;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Keeps the player's progress in a Google Play Games saved game, so it follows their Google
 * account to a new phone or a reinstall. One slot holds the whole save as JSON text; the game
 * merges it with the copy on the phone (the merge it passes to createCloudSave).
 *
 * The plugin name, the slot name and the conflict policy are what every player's existing save
 * is stored under, in all three games. Never change them.
 */
@CapacitorPlugin(name = "CloudSave")
public class CloudSavePlugin extends Plugin {

    private static final String SLOT = "progress";

    /** Whether Play Games signed the player in (it tries on its own when the game starts). */
    @PluginMethod
    public void status(PluginCall call) {
        PlayGames.getGamesSignInClient(getActivity())
            .isAuthenticated()
            .addOnCompleteListener(task -> {
                JSObject result = new JSObject();
                result.put("signedIn", task.isSuccessful() && task.getResult().isAuthenticated());
                call.resolve(result);
            });
    }

    /** The saved progress as JSON text, or an empty string when there is none yet. */
    @PluginMethod
    public void load(PluginCall call) {
        SnapshotsClient snapshots = PlayGames.getSnapshotsClient(getActivity());
        snapshots
            .open(SLOT, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnCompleteListener(task -> {
                Snapshot snapshot = task.isSuccessful() ? task.getResult().getData() : null;
                if (snapshot == null) {
                    call.reject("could not open the saved game", task.getException());
                    return;
                }
                try {
                    byte[] bytes = snapshot.getSnapshotContents().readFully();
                    JSObject result = new JSObject();
                    result.put("data", new String(bytes, StandardCharsets.UTF_8));
                    call.resolve(result);
                } catch (IOException e) {
                    call.reject("could not read the saved game", e);
                } finally {
                    snapshots.discardAndClose(snapshot);
                }
            });
    }

    /** Replaces the saved progress with `data` (JSON text). */
    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("nothing to save");
            return;
        }
        String description = call.getString("description", "Game progress");
        SnapshotsClient snapshots = PlayGames.getSnapshotsClient(getActivity());
        snapshots
            .open(SLOT, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnCompleteListener(task -> {
                Snapshot snapshot = task.isSuccessful() ? task.getResult().getData() : null;
                if (snapshot == null) {
                    call.reject("could not open the saved game", task.getException());
                    return;
                }
                snapshot.getSnapshotContents().writeBytes(data.getBytes(StandardCharsets.UTF_8));
                SnapshotMetadataChange change = new SnapshotMetadataChange.Builder().setDescription(description).build();
                snapshots
                    .commitAndClose(snapshot, change)
                    .addOnCompleteListener(done -> {
                        if (done.isSuccessful()) call.resolve();
                        else call.reject("could not write the saved game", done.getException());
                    });
            });
    }
}
