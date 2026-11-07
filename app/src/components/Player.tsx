import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toggleLike, useLiked } from '../lib/library';
import { cycleRepeat, dispatch, player, toggleAutoplay, toggleShuffle } from '../lib/player';
import { roomStore } from '../lib/room';
import { artOf, fmt, type Track } from '../lib/types';
import { thump, tick, ui } from '../lib/ui';
import { c, spring } from '../theme';
import { Art, Eq, Glass, Icon, IconBtn, Tap } from './ui';

const H = Dimensions.get('window').height;
const W = Dimensions.get('window').width;

export function MiniPlayer() {
  const { queue, index, playing, time, duration } = player.use();
  const t = queue[index];
  if (!t) return null;
  return (
    <Animated.View entering={FadeIn.duration(240)}>
      <Tap scale={0.98} onPress={() => ui.set({ playerOpen: true })}>
        <Glass strong radius={22} style={st.mini}>
          <Art uri={t.thumb} size={44} radius={12} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={st.title}>
              {t.title}
            </Text>
            <Text numberOfLines={1} style={st.sub}>
              {t.artist}
            </Text>
          </View>
          <IconBtn
            name={playing ? 'pause' : 'play'}
            size={26}
            onPress={() => {
              tick();
              dispatch({ type: playing ? 'pause' : 'play' });
            }}
          />
          <IconBtn name="play-skip-forward" size={22} onPress={() => dispatch({ type: 'next' })} />
          <View style={[st.miniBar, { width: `${duration ? (time / duration) * 100 : 0}%` }]} />
        </Glass>
      </Tap>
    </Animated.View>
  );
}

// Full screen player: slides up, follows your finger when you drag it down.
export function FullPlayer() {
  const { playerOpen } = ui.use();
  const y = useSharedValue(H);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (playerOpen) {
      setMounted(true);
      y.value = withSpring(0, spring);
    } else y.value = withTiming(H, { duration: 260 }, (done) => done && runOnJS(setMounted)(false));
  }, [playerOpen]);

  const close = () => ui.set({ playerOpen: false });
  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 140 || e.velocityY > 900) runOnJS(close)();
      else y.value = withSpring(0, spring);
    });

  const sheet = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { scale: interpolate(y.value, [0, H], [1, 0.92], Extrapolation.CLAMP) }],
    borderRadius: interpolate(y.value, [0, 60], [0, 32], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[StyleSheet.absoluteFill, st.full, sheet]}>
        <PlayerBody onClose={close} />
      </Animated.View>
    </GestureDetector>
  );
}

function PlayerBody({ onClose }: { onClose: () => void }) {
  const { queue, index, playing, time, duration, buffering, repeat, shuffle, autoplay } = player.use();
  const { code, members } = roomStore.use();
  const [showQueue, setShowQueue] = useState(false);
  const insets = useSafeAreaInsets();
  const t = queue[index];
  const artScale = useSharedValue(playing ? 1 : 0.86);

  useEffect(() => {
    artScale.value = withSpring(playing ? 1 : 0.86, spring);
  }, [playing]);
  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: artScale.value }] }));

  if (!t) return null;
  const size = Math.min(W - 48, H * 0.42);

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
      <Image source={artOf(t)} style={StyleSheet.absoluteFill} blurRadius={60} contentFit="cover" transition={600} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,7,10,0.55)' }]} />

      <View style={st.grabber} />
      <View style={st.top}>
        <IconBtn name="chevron-down" size={26} onPress={onClose} />
        {code ? (
          <Glass radius={99} style={{ paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text style={{ color: c.accent, fontWeight: '800', letterSpacing: 2, fontSize: 12 }}>
              {code} · {members.length}
            </Text>
          </Glass>
        ) : (
          <View />
        )}
        <IconBtn name="ellipsis-horizontal" onPress={() => ui.set({ sheet: { track: t } })} />
      </View>

      {showQueue ? (
        <FlatList
          style={{ flex: 1, marginVertical: 12 }}
          data={queue}
          keyExtractor={(q, i) => q.id + i}
          initialScrollIndex={Math.max(0, index - 1)}
          getItemLayout={(_, i) => ({ length: 64, offset: 64 * i, index: i })}
          renderItem={({ item, index: i }) => (
            <Tap scale={0.98} style={[st.qRow, i === index && { backgroundColor: c.fill }]} onPress={() => dispatch({ type: 'playIndex', index: i })}>
              <Art uri={item.thumb} size={44} radius={8} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[st.title, i === index && { color: c.accent }]}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={st.sub}>
                  {item.artist}
                </Text>
              </View>
              <Eq id={item.id} />
              <IconBtn name="close" size={18} dim onPress={() => dispatch({ type: 'remove', index: i })} />
            </Tap>
          )}
        />
      ) : (
        <View style={st.artWrap}>
          <Animated.View key={t.id} entering={ZoomIn.duration(240)} style={[artStyle, st.artShadow]}>
            <Art uri={artOf(t)} size={size} radius={24} />
          </Animated.View>
        </View>
      )}

      <View style={st.metaRow}>
        <View style={{ flex: 1 }}>
          <Animated.Text key={t.id} entering={FadeIn.duration(350)} numberOfLines={1} style={st.bigTitle}>
            {t.title}
          </Animated.Text>
          <Text numberOfLines={1} style={st.sub}>
            {t.artist}
          </Text>
        </View>
        <Like track={t} />
      </View>

      <Seek time={time} duration={duration} buffering={buffering} />

      <View style={st.controls}>
        <IconBtn name="shuffle" dim={!shuffle} color={shuffle ? c.accent : c.text} onPress={toggleShuffle} />
        <IconBtn name="play-skip-back" size={32} onPress={() => (tick(), dispatch({ type: 'prev' }))} />
        <Tap
          scale={0.88}
          onPress={() => {
            thump();
            dispatch({ type: playing ? 'pause' : 'play' });
          }}
        >
          <Glass radius={40} style={st.playBig}>
            <Animated.View key={String(playing)} entering={ZoomIn.duration(240)}>
              <Icon name={playing ? 'pause' : 'play'} size={36} />
            </Animated.View>
          </Glass>
        </Tap>
        <IconBtn name="play-skip-forward" size={32} onPress={() => (tick(), dispatch({ type: 'next' }))} />
        <View>
          <IconBtn name="repeat" dim={repeat === 'off'} color={repeat !== 'off' ? c.accent : c.text} onPress={cycleRepeat} />
          {repeat === 'one' && <Text style={st.one}>1</Text>}
        </View>
      </View>

      <View style={st.extras}>
        <IconBtn name="infinite" dim={!autoplay} color={autoplay ? c.accent : c.text} onPress={toggleAutoplay} />
        <IconBtn name="list" dim={!showQueue} color={showQueue ? c.accent : c.text} onPress={() => setShowQueue((v) => !v)} />
      </View>
    </View>
  );
}

function Like({ track }: { track: Track }) {
  const liked = useLiked(track.id);
  const [pop, setPop] = useState(0);
  return (
    <Tap
      scale={0.8}
      onPress={() => {
        thump();
        setPop((n) => n + 1);
        toggleLike(track);
      }}
      style={{ padding: 8 }}
    >
      <Animated.View key={pop} entering={pop ? ZoomIn.duration(240) : undefined}>
        <Icon name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? c.like : c.muted} />
      </Animated.View>
    </Tap>
  );
}

// Seek bar: drag anywhere on it; grows while touched.
function Seek({ time, duration, buffering }: { time: number; duration: number; buffering: boolean }) {
  const [w, setW] = useState(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const active = useSharedValue(0);
  const shown = scrub ?? time;
  const frac = duration ? Math.min(1, shown / duration) : 0;

  const toTime = (x: number) => Math.max(0, Math.min(1, x / w)) * duration;
  // Tap jumps straight to that spot; drag scrubs. They are separate gestures because a
  // quick tap never activates a pan on Android.
  const pan = Gesture.Pan()
    .activeOffsetX([-3, 3])
    .onStart((e) => {
      active.value = withTiming(1, { duration: 120 });
      runOnJS(setScrub)(toTime(e.x));
    })
    .onUpdate((e) => runOnJS(setScrub)(toTime(e.x)))
    .onEnd((e) => runOnJS(commit)(toTime(e.x)))
    .onFinalize(() => {
      active.value = withTiming(0, { duration: 160 });
    });
  const tap = Gesture.Tap()
    .maxDuration(600)
    .onEnd((e, ok) => {
      if (ok) runOnJS(commit)(toTime(e.x));
    });
  const seek = Gesture.Exclusive(pan, tap);
  function commit(t: number) {
    setScrub(t);
    dispatch({ type: 'seek', time: t });
    setTimeout(() => setScrub(null), 400);
  }
  const track = useAnimatedStyle(() => ({ height: interpolate(active.value, [0, 1], [5, 10]) }));

  return (
    <View>
      <GestureDetector gesture={seek}>
        <View style={{ height: 30, justifyContent: 'center' }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
          <Animated.View style={[st.seekTrack, track, buffering && { opacity: 0.6 }]}>
            <View style={[st.seekFill, { width: `${frac * 100}%` }]} />
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={st.times}>
        <Text style={st.time}>{fmt(shown)}</Text>
        <Text style={st.time}>-{fmt(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  mini: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, paddingLeft: 8 },
  miniBar: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: c.accent },
  title: { color: c.text, fontSize: 15, fontWeight: '600' },
  sub: { color: c.muted, fontSize: 13 },
  full: { backgroundColor: c.bg, overflow: 'hidden', zIndex: 20 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -10, marginTop: 4 },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artShadow: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 24, borderRadius: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  bigTitle: { color: c.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  seekTrack: { borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  seekFill: { height: '100%', backgroundColor: c.text },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: c.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  playBig: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  one: { position: 'absolute', top: 6, right: 4, fontSize: 9, fontWeight: '900', color: c.accentInk, backgroundColor: c.accent, borderRadius: 6, paddingHorizontal: 3, overflow: 'hidden' },
  extras: { flexDirection: 'row', justifyContent: 'center', gap: 30, marginTop: 12 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, paddingHorizontal: 8, borderRadius: 14 },
});
