let ws = null;

function createRoom() {
    fetch('/create')
        .then(res => res.json())
        .then(data => {
            document.getElementById('token').value = data.token;
        });
}

function joinRoom() {
    const nick = document.getElementById('nick').value;
    const token = document.getElementById('token').value;

    ws = new WebSocket(`ws://localhost:8080/ws?nick=${nick}&token=${token}`);

    ws.onmessage = (event) => {
        const div = document.createElement('div');
        div.textContent = event.data;
        document.getElementById('messages').appendChild(div);
    };

    ws.onopen = () => {
        document.getElementById('form').style.display = 'none';
        document.getElementById('chat').classList.add('active');
    };
}

function sendMessage() {
    const input = document.getElementById('message');
    ws.send(input.value);
    input.value = '';
}
