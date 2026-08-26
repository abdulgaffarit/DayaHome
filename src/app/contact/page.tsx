import type { Metadata } from "next";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";

export const metadata: Metadata = {
  title: "যোগাযোগ",
  description: "dayarampur.com-এর সাথে যোগাযোগ করুন। দয়ারামপুর, বাগাতিপাড়া, নাটোর।",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">যোগাযোগ</h1>
      <p className="mt-3 leading-relaxed text-ink-600">
        বিজ্ঞাপন, পেমেন্ট বা অ্যাকাউন্ট সংক্রান্ত যেকোনো প্রশ্নে আমাদের জানান।
        সাধারণত এক কর্মদিবসের মধ্যে উত্তর দেওয়ার চেষ্টা করি।
      </p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <ContactItem icon={<Phone className="h-5 w-5" />} label="ফোন">
          <a href="tel:+8801700000000" className="hover:text-brand-700">
            ০১৭০০-০০০০০০
          </a>
        </ContactItem>
        <ContactItem icon={<Mail className="h-5 w-5" />} label="ইমেইল">
          <a href="mailto:support@dayarampur.com" className="hover:text-brand-700">
            support@dayarampur.com
          </a>
        </ContactItem>
        <ContactItem icon={<MapPin className="h-5 w-5" />} label="ঠিকানা">
          দয়ারামপুর, বাগাতিপাড়া, নাটোর
        </ContactItem>
        <ContactItem icon={<MessageCircle className="h-5 w-5" />} label="সহায়তার সময়">
          শনি – বৃহস্পতি, সকাল ১০টা – সন্ধ্যা ৬টা
        </ContactItem>
      </dl>

      <section className="mt-10 rounded-[--radius-card] border border-brand-100 bg-surface-mint p-6">
        <h2 className="text-lg font-semibold text-brand-900">পেমেন্ট সংক্রান্ত সমস্যা?</h2>
        <p className="mt-2 leading-relaxed text-ink-700">
          টাকা কেটে নেওয়ার পরও যদি যোগাযোগের তথ্য না দেখা যায়, ড্যাশবোর্ডের
          &ldquo;পেমেন্ট&rdquo; পাতা থেকে ট্রানজেকশন আইডি নিয়ে আমাদের জানান।
          যাচাই করে সমাধান করে দেওয়া হবে।
        </p>
      </section>
    </div>
  );
}

function ContactItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[--radius-card] border border-ink-100 bg-white p-5">
      <span className="mt-0.5 text-brand-700" aria-hidden="true">
        {icon}
      </span>
      <div>
        <dt className="text-sm text-ink-500">{label}</dt>
        <dd className="mt-0.5 font-medium text-ink-900">{children}</dd>
      </div>
    </div>
  );
}
