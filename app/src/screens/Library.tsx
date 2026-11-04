import { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInRight } from 'react-native-reanimated';
import TrackRow from '../components/TrackRow';
import { Art, Glass, Icon, IconBtn, Tap } from '../components/ui';
import { ask } from '../components/Overlays';
import { LIKED, createPlaylist, download, library, loadGroup, removePlaylist, renamePlaylist, shareToGroup } from '../lib/library';
import { dispatch } from '../lib/player';
import { artOf, type Playlist, type Track } from '../lib/types';
import { tick, toast } from '../lib/ui';
import { c } from '../theme';
import { s as home } from './Home';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DOWNLOADS = '__downloads';
const shuffled = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

export default function Library() {
  const { playlists, downloads, group } = library.use();
  const [open, setOpen] = useState<{ id: string; from: 'mine' | 'group' } | null>(null);

  useEffect(() => {
    loadGroup();
  }, []);

  const dl = Object.values(downloads);
  let current: Playlist | undefined;
  if (open?.id === DOWNLOADS) current = { id: DOWNLOADS, name: 'Downloads', tracks: dl, created: 0 };
  else if (open?.from === 'group') current = group.find((p) => p.id === open.id);
  else if (open) current = playlists.find((p) => p.id === open.id);

  if (current && open)
    return <PlaylistView key={current.id} p={current} kind={open.id === DOWNLOADS ? 'downloads' : open.from} onBack={() => setOpen(null)} />;

  const sorted = [...playlists].sort((a, b) => (a.id === LIKED ? -1 : b.id === LIKED ? 1 : a.created - b.created));

  return (
    <ScrollView contentContainerStyle={home.page} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={home.h1}>Library</Text>
        <IconBtn
          name="add"
          size={26}
          onPress={async () => {
            const name = await ask('New playlist');
            if (name) setOpen({ id: createPlaylist(name).id, from: 'mine' });
          }}
        />
      </View>
      <View style={st.grid}>
        <Tile i={0} title="Downloads" sub={`${dl.length}`} onPress={() => setOpen({ id: DOWNLOADS, from: 'mine' })} icon="arrow-down" />
        {sorted.map((p, i) => (
          <Tile key={p.id} i={i + 1} title={p.name} sub={`${p.tracks.length}`} tracks={p.tracks} icon={p.id === LIKED ? 'heart' : undefined} onPress={() => setOpen({ id: p.id, from: 'mine' })} />
        ))}
      </View>
      {group.length > 0 && (
        <>
          <Text style={home.h2}>Group</Text>
          <View style={st.grid}>
            {group.map((p, i) => (
              <Tile key={p.id} i={i} title={p.name} sub={p.owner || ''} tracks={p.tracks} onPress={() => setOpen({ id: p.id, from: 'group' })} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Cover({ tracks, size, icon }: { tracks?: Track[]; size: number; icon?: string }) {
  if (icon || !tracks?.length)
    return (
      <View style={[st.cover, { width: size, height: size, backgroundColor: icon === 'heart' ? '#ff4d6d' : icon ? c.accent : c.fill }]}>
        <Icon name={(icon as 'heart') || 'musical-notes'} size={size / 4} color={icon ? c.accentInk : c.muted} />
      </View>
    );
  if (tracks.length < 4) return <Art uri={artOf(tracks[0])} size={size} radius={18} />;
  return (
    <View style={[st.cover, { width: size, height: size, flexDirection: 'row', flexWrap: 'wrap' }]}>
      {tracks.slice(0, 4).map((t) => (
        <Art key={t.id} uri={t.thumb} size={size / 2} radius={0} />
      ))}
    </View>
  );
}

function Tile({ i, title, sub, tracks, icon, onPress }: { i: number; title: string; sub: string; tracks?: Track[]; icon?: string; onPress: () => void }) {
  return (
    <Animated.View entering={FadeInDown.delay(i * 35).springify().damping(18)} style={st.tile}>
      <Tap scale={0.96} onPress={onPress}>
        <Cover tracks={tracks} size={160} icon={icon} />
        <Text numberOfLines={1} style={st.tileTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={home.sub}>
          {sub}
        </Text>
      </Tap>
    </Animated.View>
  );
}

function PlaylistView({ p, kind, onBack }: { p: Playlist; kind: 'mine' | 'group' | 'downloads'; onBack: () => void }) {
  const { downloads, group } = library.use();
  const missing = p.tracks.filter((t) => !downloads[t.id]);
  const shared = group.some((g) => g.id === p.id);

  return (
    <Animated.View entering={SlideInRight.springify().damping(20)} style={{ flex: 1 }}>
      <FlatList
        data={p.tracks}
        keyExtractor={(t, i) => t.id + i}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 190 }}
        ListHeaderComponent={
          <View>
            <IconBtn name="chevron-back" size={26} onPress={onBack} style={{ marginLeft: -10, marginTop: 6 }} />
            <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center', marginTop: 4 }}>
              <Cover tracks={p.tracks} size={210} icon={kind === 'downloads' ? 'arrow-down' : p.id === LIKED ? 'heart' : undefined} />
              <Text style={[home.h1, { marginBottom: 2 }]}>{p.name}</Text>
              <Text style={home.sub}>{p.tracks.length} songs</Text>
            </Animated.View>
            <View style={st.actions}>
              <Tap
                disabled={!p.tracks.length}
                onPress={() => {
                  tick();
                  dispatch({ type: 'setQueue', queue: p.tracks, index: 0 });
                }}
                style={st.play}
              >
                <Icon name="play" size={18} color={c.accentInk} />
                <Text style={{ color: c.accentInk, fontWeight: '800', fontSize: 15 }}>Play</Text>
              </Tap>
              <Round name="shuffle" disabled={!p.tracks.length} onPress={() => dispatch({ type: 'setQueue', queue: shuffled(p.tracks), index: 0 })} />
              {kind !== 'downloads' && (
                <Round
                  name={missing.length ? 'arrow-down' : 'checkmark'}
                  disabled={!missing.length}
                  onPress={() => {
                    missing.forEach(download);
                    toast(`Downloading ${missing.length}`);
                  }}
                />
              )}
              {kind === 'group' && (
                <Round
                  name="add"
                  onPress={() => {
                    createPlaylist(p.name, p.tracks);
                    toast('Saved');
                  }}
                />
              )}
              {kind === 'mine' && (
                <>
                  <Round
                    name="people"
                    lit={shared}
                    onPress={async () => {
                      const owner = (await AsyncStorage.getItem('sunaan:name')) || 'Someone';
                      toast((await shareToGroup(p, owner)) ? (shared ? 'Updated' : 'Shared') : 'Share failed');
                    }}
                  />
                  {p.id !== LIKED && (
                    <>
                      <Round
                        name="pencil"
                        onPress={async () => {
                          const name = await ask('Rename', p.name);
                          if (name) renamePlaylist(p, name);
                        }}
                      />
                      <Round
                        name="trash-outline"
                        onPress={async () => {
                          if ((await ask(`Type DELETE to remove "${p.name}"`)) === 'DELETE') {
                            removePlaylist(p.id);
                            onBack();
                          }
                        }}
                      />
                    </>
                  )}
                </>
              )}
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow track={item} i={index} playlist={kind === 'mine' ? p : undefined} onPlay={() => dispatch({ type: 'setQueue', queue: p.tracks, index })} />
        )}
      />
    </Animated.View>
  );
}

function Round({ name, onPress, disabled, lit }: { name: 'add'; onPress: () => void; disabled?: boolean; lit?: boolean } | { name: any; onPress: () => void; disabled?: boolean; lit?: boolean }) {
  return (
    <Tap disabled={disabled} onPress={onPress} scale={0.9}>
      <Glass radius={22} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={name} size={20} color={lit ? c.accent : c.text} />
      </Glass>
    </Tap>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
  tile: { width: 160 },
  tileTitle: { color: c.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
  cover: { borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginVertical: 18, flexWrap: 'wrap' },
  play: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 22, borderRadius: 99, backgroundColor: c.accent },
});
