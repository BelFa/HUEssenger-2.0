export const mockLogin = async (data) => {
  console.log("mock login", data);

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        user: {
          id: 1,
          name: "Test User"
        }
      });
    }, 500);
  });
};

export const mockRegister = async (data) => {
  console.log("mock register", data);

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true });
    }, 500);
  });
};

export const mockSendMessage = async (message) => {
  console.log("mock send", message);

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true });
    }, 200);
  });
};