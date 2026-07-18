const Card = ({ icon, image, title, text }) => {
  return (
    <div className="flex flex-col items-start gap-3 p-5 rounded-lg bg-white shadow-2xs hover:shadow-md transition">
      {image ? (
        <img
          src={image}
          alt={title}
          className="w-full h-32 object-cover rounded-md mb-2"
        />
      ) : (
        <div className="w-12 h-12 rounded-full flex justify-center items-center bg-blue-600/12 shadow-2xs">
          <div className="text-[#2563eb] text-2xl">{icon}</div>
        </div>
      )}
      <h3 className="text-lg font-semibold text-[#0F172A]">{title}</h3>
      <p className="text-[#64748B] text-sm">{text}</p>
    </div>
  );
};

export default Card;
