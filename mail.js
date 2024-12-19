
// Add event listener to the form
document.getElementById('test-form').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent the default form submission

    // Get form values
    const fullName = document.getElementById('fullName').value;
    const phone = document.getElementById('phone').value;
    const email = document.getElementById('email').value;
    const comments = document.getElementById('comments').value;

    // Send email using EmailJS
    emailjs.send('AboutUsId', 'template_dmmje0b', {
        from_name: fullName,
        from_phone: phone,
        from_email: email,
        message: comments
    }).then(function(response) {
        console.log('Success:', response);
        alert('Email sent successfully!');
    }, function(error) {
        console.log('Error:', error);
        alert('Failed to send email.');
    });
});
