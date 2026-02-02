import Footer from "@/components/landing-page/Footer";

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <div className="mt-10">
        <Footer />
      </div>
    </>
  );
}
