const reveal = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{ if(entry.isIntersecting) entry.target.classList.add('visible'); });
},{threshold:.08});
document.querySelectorAll('.reveal').forEach(el=>reveal.observe(el));
document.querySelectorAll('.faq-list details').forEach(detail=>{
  detail.addEventListener('toggle',()=>{
    if(!detail.open) return;
    document.querySelectorAll('.faq-list details').forEach(other=>{ if(other!==detail) other.open=false; });
  });
});
