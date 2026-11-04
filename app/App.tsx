import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet, AskModal, Toast } from './src/components/Overlays';
import { FullPlayer, MiniPlayer } from './src/components/Player';
import { Glass, Icon, Tap, type IconName } from './src/components/ui';
import { loadHistory } from './src/lib/history';
import { loadLibrary } from './src/lib/library';
import { initPlayer, player } from './src/lib/player';
import { joinRoom, roomStore } from './src/lib/room';
import { conn, connect, initServer, unlock } from './src/lib/server';
import { artOf } from './src/lib/types';
import { tick, ui } from './src/lib/ui';
import Home from './src/screens/Home';
import Library from './src/screens/Library';
import Room from './src/screens/Room';
import Search from './src/screens/Search';
import { c, spring } from './src/theme';

const TABS: { id: 'home' | 'search' | 'library' | 'room'; icon: IconName; on: IconName }[] = [
  { id: 'home', icon: 'home-outline', on: 'home' },
  { id: 'search', icon: 'search-outline', on: 'search' },
  { id: 'library', icon: 'library-outline', on: 'library' },
  { id: 'room', icon: 'people-outline', on: 'people' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await Promise.all([loadLibrary(), loadHistory(), initPlayer()]);
      setReady(true);
      await initServer();
      const [room, name] = await Promise.all([AsyncStorage.getItem('sunaan:room'), AsyncStorage.getItem('sunaan:name')]);
      if (room && name && conn.get().status === 'ok') joinRoom(room, name);
    })();
    if (Platform.OS === 'android') NavigationBar.setStyle('light');
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready ? <Shell /> : <View style={{ flex: 1, backgroundColor: c.bg }} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Shell() {
  const { status } = conn.use();
  if (status === 'locked') return <Lock />;
  return (
    <View style={{ flex: 1 }}>
      <Ambient />
      <Screens />
      {(status === 'finding' || status === 'offline') && <Banner status={status} />}
      <Dock />
      <FullPlayer />
      <ActionSheet />
      <AskModal />
      <Toast />
    </View>
  );
}

// Blurred artwork of the current song behind everything, so the glass has colour.
function Ambient() {
  const { queue, index } = player.use();
  const t = queue[index];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {t && <Image source={artOf(t)} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} blurRadius={70} contentFit="cover" transition={900} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,7,10,0.6)' }]} />
    </View>
  );
}

// All tabs stay mounted (keeps scroll position and search results); only the active one shows.
function Screens() {
  const { tab } = ui.use();
  const insets = useSafeAreaInsets();
  const screens = { home: <Home />, search: <Search />, library: <Library />, room: <Room /> };
  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      {TABS.map(({ id }) => (
        <View key={id} style={[StyleSheet.absoluteFill, { top: insets.top }, tab !== id && st.hidden]} pointerEvents={tab === id ? 'auto' : 'none'}>
          {tab === id ? <Animated.View entering={FadeIn.duration(220)} style={{ flex: 1 }}>{screens[id]}</Animated.View> : screens[id]}
        </View>
      ))}
    </View>
  );
}

function Dock() {
  const { tab } = ui.use();
  const { code } = roomStore.use();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const i = TABS.findIndex((x) => x.id === tab);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring((i * (w - 16)) / 4, spring) }] }), [i, w]);

  return (
    <View style={[st.dock, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
      <MiniPlayer />
      <Glass strong radius={31} style={st.tabs}>
        <View style={{ flex: 1, flexDirection: 'row' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 && <Animated.View style={[st.pill, { width: (w - 16) / 4 }, pill]} />}
          {TABS.map((x) => (
            <Tap
              key={x.id}
              scale={0.85}
              style={st.tab}
              onPress={() => {
                tick();
                ui.set({ tab: x.id });
              }}
            >
              <Icon name={tab === x.id ? x.on : x.icon} size={23} color={tab === x.id ? c.text : c.muted} />
              {x.id === 'room' && code && <View style={st.badge} />}
            </Tap>
          ))}
        </View>
      </Glass>
    </View>
  );
}

function Banner({ status }: { status: 'finding' | 'offline' }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn} style={[st.banner, { top: insets.top + 8 }]}>
      <Tap onPress={() => status === 'offline' && connect()}>
        <Glass strong radius={99} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
          {status === 'finding' ? <ActivityIndicator size="small" color={c.accent} /> : <Icon name="cloud-offline-outline" size={16} color={c.muted} />}
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{status === 'finding' ? 'Connecting' : 'Offline · downloads still play · tap to retry'}</Text>
        </Glass>
      </Tap>
    </Animated.View>
  );
}

function Lock() {
  const [key, setKey] = useState('');
  const [bad, setBad] = useState(false);
  const submit = async () => {
    if (!(await unlock(key))) setBad(true);
  };
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Ambient />
      <Animated.View entering={FadeIn.springify()} style={{ width: '100%', maxWidth: 360 }}>
        <Glass strong radius={28} style={{ padding: 24, gap: 14, alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }}>Sunaan</Text>
          <TextInput
            value={key}
            onChangeText={(t) => {
              setKey(t);
              setBad(false);
            }}
            onSubmitEditing={submit}
            placeholder="Group key"
            placeholderTextColor={c.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[st.field, bad && { borderColor: c.danger }]}
          />
          <Tap onPress={submit} style={st.enter}>
            <Text style={{ color: c.accentInk, fontWeight: '800', fontSize: 16 }}>Enter</Text>
          </Tap>
        </Glass>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  hidden: { opacity: 0 },
  dock: { position: 'absolute', left: 12, right: 12, gap: 8 },
  tabs: { height: 62, alignSelf: 'center', width: 320, padding: 8 },
  tab: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.13)' },
  badge: { position: 'absolute', top: 10, right: '30%', width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
  banner: { position: 'absolute', alignSelf: 'center', zIndex: 30 },
  field: { width: '100%', height: 50, borderRadius: 14, paddingHorizontal: 15, color: c.text, fontSize: 16, backgroundColor: c.fill, borderWidth: 1, borderColor: 'transparent' },
  enter: { width: '100%', height: 48, borderRadius: 99, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
});
