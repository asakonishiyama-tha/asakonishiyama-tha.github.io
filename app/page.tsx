import Link from "next/link";

import { listPublishedTalks } from "@/lib/content/talk-repository";

import styles from "./home.module.css";

export default async function Home() {
  const talks = await listPublishedTalks();

  return (
    <main className={styles.library}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>THA / HOOKED TALKS</p>
        <h1>登壇ライブラリ</h1>
        <p className={styles.intro}>問い、診断、次の一歩まで。THAの登壇体験を、テーマごとに残して育てる場所です。</p>
        <p className={styles.speaker}>西山朝子 / THA</p>
      </header>

      <section className={styles.talks} aria-label="公開中の登壇">
        {talks.map((talk, index) => {
          const hero = talk.scenes.find((scene) => scene.type === "hero");

          return (
            <article className={styles.talk} key={talk.slug}>
              <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.talkBody}>
                <p className={styles.event}>{talk.eventName}</p>
                <h2>{talk.title}</h2>
                {hero?.supportingText ? <p className={styles.summary}>{hero.supportingText}</p> : null}
                <p className={styles.speaker}>SPEAKER / {talk.speaker}</p>
              </div>
              <Link
                aria-label={`${talk.title}を体験する`}
                className={styles.open}
                href={`/talks/${talk.slug}`}
              >
                <span>体験をひらく</span>
                <span aria-hidden="true">↗</span>
              </Link>
            </article>
          );
        })}
      </section>

      <footer className={styles.footer}>
        <p>NEW TALK, NEW QUESTION.</p>
        <span>新しいTalkは、公開前レビューを経て追加します。</span>
      </footer>
    </main>
  );
}
