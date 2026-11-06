import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import Marquee from './components/Marquee.jsx';
import Stats from './components/Stats.jsx';
import Journey from './components/Journey.jsx';
import Capabilities from './components/Capabilities.jsx';
import Tour from './components/Tour.jsx';
import ScreenWall from './components/ScreenWall.jsx';
import Difference from './components/Difference.jsx';
import Ecosystem from './components/Ecosystem.jsx';
import Playground from './components/Playground.jsx';
import Trust from './components/Trust.jsx';
import CTA from './components/CTA.jsx';
import Footer from './components/Footer.jsx';
import CursorGlow from './components/fx/CursorGlow.jsx';
import ScrollProgress from './components/fx/ScrollProgress.jsx';

export default function App() {
  return (
    <>
      <ScrollProgress />
      <CursorGlow />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Stats />
        <Journey />
        <Capabilities />
        <Tour />
        <ScreenWall />
        <Difference />
        <Ecosystem />
        <Playground />
        <Trust />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
