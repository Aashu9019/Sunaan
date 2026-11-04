import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addToPlaylist, createPlaylist, download, library, removeDownload, removeFromPlaylist, toggleLike, useLiked } from '../lib/library';
import { dispatch } from '../lib/player';
import { createStore } from '../lib/store';
import { toast, ui } from '../lib/ui';
import { c } from '../theme';
import { Art, Glass, Icon, Tap, type IconName } from './ui';

// ---------- text prompt (Android has no window.prompt) ----------

const askStore = createStore({ title: '', value: '', resolve: null as null | ((v: string | null) => void) });
export const ask = (title: string, value = '') =>
  new Promise<string | null>((resolve) => askStore.set({ title, value, resolve }));

export function AskModal() {
  const { title, value, resolve } = askStore.use();
  const [text, setText] = useState('');
  const done = (v: string | null) => {
    resolve?.(v && v.trim() ? v.trim() : null);
    askStore.set({ resolve: null });
  };
  return (
    <Modal transparent visible={!!resolve} animationType="fade" onShow={() => setText(value)} onRequestClose={() => done(null)}>
      <Pressable style={st.scrim} onPress={() => done(null)}>
        <Pressable onPress={() => {}} style={{ width: '86%' }}>
          <Glass strong radius={26} style={{ padding: 20, gap: 14 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
            <TextInput autoFocus value={text} onChangeText={setText} onSubmitEditing={() => done(text)} style={st.field} selectionColor={c.accent} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
              <Text onPress={() => done(null)} style={{ color: c.muted, fontWeight: '600', padding: 6 }}>
                Cancel
              </Text>
              <Text onPress={() => done(text)} style={{ color: c.accent, fontWeight: '800', padding: 6 }}>
                OK
              </Text>
            </View>
          </Glass>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- song menu ----------

export function ActionSheet() {
  const { sheet } = ui.use();
  const { playlists, downloads, progress } = library.use();
  const liked = useLiked(sheet?.track.id ?? '');
  const [picking, setPicking] = useState(false);
  const insets = useSafeAreaInsets();
  if (!sheet) return null;
  const { track: t, playlist, index } = sheet;
  const close = () => {
    setPicking(false);
    ui.set({ sheet: null });
  };
  const act = (fn: () => unknown, msg?: string) => () => {
    fn();
    if (msg) toast(msg);
    close();
  };
  const Item = ({ icon, label, onPress, color }: { icon: IconName; label: string; onPress: () => void; color?: string }) => (
    <Tap scale={0.98} style={st.item} onPress={onPress}>
      <Icon name={icon} color={color} />
      <Text style={[st.itemText, color ? { color } : null]}>{label}</Text>
    </Tap>
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn} exiting={FadeOut} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <Pressable style={{ flex: 1 }} onPress={close} />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(240)} exiting={SlideOutDown.duration(200)} style={[st.sheetWrap, { paddingBottom: insets.bottom + 10 }]}>
        <Glass strong radius={28} style={{ padding: 10 }}>
          <View style={st.head}>
            <Art uri={t.thumb} size={48} radius={10} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={st.itemText}>
                {t.title}
              </Text>
              <Text numberOfLines={1} style={{ color: c.muted }}>
                {t.artist}
              </Text>
            </View>
          </View>
          {picking ? (
            <>
              <Item
                icon="add"
                label="New playlist"
                onPress={async () => {
                  close();
                  const name = await ask('New playlist');
                  if (name) {
                    createPlaylist(name, [t]);
                    toast(`Added to ${name}`);
                  }
                }}
              />
              {playlists.map((p) => (
                <Item key={p.id} icon="list" label={p.name} onPress={act(() => addToPlaylist(p, t), `Added to ${p.name}`)} />
              ))}
            </>
          ) : (
            <>
              <Item icon="play" label="Play now" onPress={act(() => dispatch({ type: 'setQueue', queue: [t], index: 0 }))} />
              <Item icon="list" label="Add to queue" onPress={act(() => dispatch({ type: 'enqueue', track: t }), 'Added to queue')} />
              <Item icon={liked ? 'heart' : 'heart-outline'} color={liked ? c.like : undefined} label={liked ? 'Unlike' : 'Like'} onPress={act(() => toggleLike(t), liked ? 'Removed from Liked' : 'Liked')} />
              <Item icon="add" label="Add to playlist" onPress={() => setPicking(true)} />
              {downloads[t.id] ? (
                <Item icon="trash-outline" label="Remove download" onPress={act(() => removeDownload(t.id), 'Download removed')} />
              ) : (
                <Item icon="arrow-down-circle-outline" label={progress[t.id] != null ? 'Downloading...' : 'Download'} onPress={act(() => download(t), 'Downloading...')} />
              )}
              {playlist && index != null && <Item icon="close" color={c.danger} label={`Remove from ${playlist.name}`} onPress={act(() => removeFromPlaylist(playlist, index), 'Removed')} />}
            </>
          )}
        </Glass>
      </Animated.View>
    </View>
  );
}

export function Toast() {
  const { toast: msg } = ui.use();
  const insets = useSafeAreaInsets();
  if (!msg) return null;
  return (
    <Animated.View key={msg} entering={FadeInUp.duration(240)} exiting={FadeOut} pointerEvents="none" style={[st.toast, { top: insets.top + 10 }]}>
      <Glass strong radius={99} style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
        <Text style={{ color: c.text, fontWeight: '600' }}>{msg}</Text>
      </Glass>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  field: { backgroundColor: c.fill, borderRadius: 14, paddingHorizontal: 14, height: 48, color: c.text, fontSize: 16 },
  sheetWrap: { position: 'absolute', left: 10, right: 10, bottom: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.edge, marginBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 16 },
  itemText: { color: c.text, fontSize: 15, fontWeight: '600' },
  toast: { position: 'absolute', alignSelf: 'center', zIndex: 50 },
});
