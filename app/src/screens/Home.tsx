import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { Art, Eq, Glass, Icon, Skeleton, Tap } from '../components/ui';
import { history } from '../lib/history';
import { library } from '../lib/library';
import { dispatch } from '../lib/player';
import { getJSON } from '../lib/server';
import { artOf, type Track } from '../lib/types';
import { tick, ui } from '../lib/ui';
import { c } from '../theme';

const SHELVES = [
  { title: 'Trending', q: 'new hit songs 2026 official music video' },
  { title: 'Chill', q: 'chill pop songs official audio' },
  { title: 'Hindi', q: 'latest hindi songs 2026 audio' },
  { title: 'Nepali', q: 'latest nepali songs 2026' },
  { title: 'Throwback', q: '2000s hits official audio' },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function Home() {
  const { recent } = history.use();
  const { playlists, downloads } = library.use();
  const dl = Object.values(downloads);
  const quick = [
    ...(dl.length ? [{ key: 'dl', label: 'Downloads', tracks: dl, icon: true }] : []),
    ...playlists.filter((p) => p.tracks.length).map((p) => ({ key: p.id, label: p.name, tracks: p.tracks, icon: false })),
    ...recent.slice(0, 6).map((t) => ({ key: 't' + t.id, label: t.title, tracks: [t], icon: false })),
  ].slice(0, 6);

  return (
    <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
      <Animated.Text entering={FadeInDown.springify()} style={s.h1}>
        {greeting()}
      </Animated.Text>

      {quick.length > 0 && (
        <View style={s.quick}>
          {quick.map((q, i) => (
            <Animated.View key={q.key} entering={FadeInDown.delay(i * 40).springify()} style={s.quickCell}>
              <Tap
                scale={0.96}
                onPress={() => {
                  tick();
                  dispatch({ type: 'setQueue', queue: q.tracks, index: 0 });
                }}
              >
                <Glass radius={14} style={s.quickItem}>
                  {q.icon ? (
                    <View style={[s.quickArt, { backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }]}>
                      <Icon name="arrow-down" color={c.accentInk} />
                    </View>
                  ) : (
                    <Art uri={q.tracks[0].thumb} size={56} radius={0} />
                  )}
                  <Text numberOfLines={2} style={s.quickText}>
                    {q.label}
                  </Text>
                  <Eq id={q.tracks[0].id} />
                </Glass>
              </Tap>
            </Animated.View>
          ))}
        </View>
      )}

      {recent.length > 0 && <Shelf title="Recently played" items={recent} />}
      {SHELVES.map((x) => (
        <RemoteShelf key={x.q} title={x.title} q={x.q} />
      ))}
    </ScrollView>
  );
}

function RemoteShelf({ title, q }: { title: string; q: string }) {
  const [items, setItems] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    getJSON<Track[]>(`/api/search?q=${encodeURIComponent(q)}`, []).then((r) => alive && setItems(r.slice(0, 15)));
    return () => {
      alive = false;
    };
  }, [q]);
  if (items && !items.length) return null;
  return <Shelf title={title} items={items} />;
}

function Shelf({ title, items }: { title: string; items: Track[] | null }) {
  return (
    <View>
      <Text style={s.h2}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroller} decelerationRate="fast" snapToInterval={162}>
        {items
          ? items.map((t, i) => (
              <Animated.View key={t.id} entering={FadeInRight.delay(Math.min(i, 6) * 45).springify().damping(18)}>
                <Tap
                  scale={0.95}
                  style={s.card}
                  onPress={() => {
                    tick();
                    dispatch({ type: 'setQueue', queue: items.slice(i), index: 0 });
                  }}
                  onLongPress={() => ui.set({ sheet: { track: t } })}
                >
                  <View>
                    <Art uri={artOf(t)} size={148} radius={18} />
                    <View style={s.cardEq}>
                      <Eq id={t.id} />
                    </View>
                  </View>
                  <Text numberOfLines={1} style={s.cardTitle}>
                    {t.title}
                  </Text>
                  <Text numberOfLines={1} style={s.sub}>
                    {t.artist}
                  </Text>
                </Tap>
              </Animated.View>
            ))
          : [0, 1, 2, 3].map((i) => (
              <View key={i} style={s.card}>
                <Skeleton w={148} h={148} radius={18} />
                <Skeleton w={120} h={11} style={{ marginTop: 10 }} />
                <Skeleton w={80} h={11} style={{ marginTop: 6 }} />
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

export const s = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 190 },
  h1: { color: c.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginVertical: 12 },
  h2: { color: c.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.4, marginTop: 28, marginBottom: 12 },
  sub: { color: c.muted, fontSize: 13 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickCell: { width: '48.8%' },
  quickItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, paddingRight: 8 },
  quickArt: { width: 56, height: 56 },
  quickText: { flex: 1, color: c.text, fontSize: 13, fontWeight: '600' },
  scroller: { gap: 14, paddingRight: 16 },
  card: { width: 148 },
  cardTitle: { color: c.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  cardEq: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 99, paddingVertical: 5 },
});
