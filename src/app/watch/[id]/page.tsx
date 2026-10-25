import Image from "next/image";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilmMeta } from "@/components/catalog";
import { findPublicVideo } from "@/features/discovery/service";
import { FilmPlayer } from "@/components/film-player";
import { ViewerActions } from "@/components/viewer-actions";
export default async function Watch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let video;
  try {
    video = await findPublicVideo(id);
  } catch {
    return <CatalogUnavailable href={`/watch/${encodeURIComponent(id)}`} />;
  }
  if (!video) notFound();
  return (
    <section className="page-content detail-page">
      <Link className="text-link" href="/">
        Back to discovery
      </Link>
      {video.artwork && (
        <div className="detail-image">
          <Image
            src={video.artwork}
            unoptimized
            alt={`Thumbnail for ${video.title}`}
            fill
            priority
            sizes="90vw"
          />
        </div>
      )}
      <h1>{video.title}</h1>
      <FilmMeta video={video} />
      <p className="page-intro">{video.description}</p>
      <>
        <FilmPlayer videoId={id} title={video.title} />
        <p className="supporting-note">AI-created film · Human-reviewed publication.</p>
        <Link className="text-link" href={`/creator/${video.creator}`}>
          Explore this creator
        </Link>
        <ViewerActions videoId={id} creatorId={video.creator} />
      </>
      <div className="form-actions">
        {video.tags.map((tag) => (
          <Link className="text-link" key={tag} href={`/tag/${encodeURIComponent(tag)}`}>
            #{tag}
          </Link>
        ))}
      </div>
    </section>
  );
}
