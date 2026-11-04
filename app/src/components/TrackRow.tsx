import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { library } from '../lib/library';
import { player } from '../lib/player';
import { fmt, type Playlist, type Track } from '../lib/types';
import { tick, ui } from '../lib/ui';
import { c } from '../theme';
import { Art, Eq, Icon, IconBtn, Tap } from './ui';

type Props = { track: Track; i?: number; onPlay: () => void; playlist?: Playlist };

function TrackRow({ track, i = 0, onPlay, playlist }: Props) {
  const { downloads, progress } = library.use();
  const { queue, index } = player.use();
  const active = queue[index]?.id === track.id;
  const p = progress[track.id];
  const more = () => ui.set({ sheet: { track, playlist, index: i } });

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 12) * 28).duration(240)} style={s.row}>
      <Tap
        style={s.main}
        scale={0.97}
        onPress={() => {
          tick();
          onPlay();
        }}
        onLongPress={more}
      >
        <View>
          <Art uri={track.thumb} size={50} radius={10} />
          {p != null && (
            <View style={s.pct}>
              <Text style={s.pctText}>{Math.round(p * 100)}%</Text>
            </View>
          )}
        </View>
        <View style={s.meta}>
          <Text numberOfLines={1} style={[s.title, active && { color: c.accent }]}>
            {track.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {downloads[track.id] && <Icon name="arrow-down-circle" size={13} color={c.accent} />}
            <Text numberOfLines={1} style={s.sub}>
              {track.artist} · {fmt(track.duration)}
            </Text>
          </View>
        </View>
        <Eq id={track.id} />
      </Tap>
      <IconBtn name="ellipsis-horizontal" dim onPress={more} />
    </Animated.View>
  );
}

export default memo(TrackRow);

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: c.text, fontSize: 15, fontWeight: '600' },
  sub: { color: c.muted, fontSize: 13, flexShrink: 1 },
  pct: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  pctText: { color: c.accent, fontSize: 11, fontWeight: '700' },
});
